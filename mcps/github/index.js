import { configurationError, guardedServer } from "./bundle.js";
import crypto from "node:crypto";


// ── Sealed Box implementation for GitHub Secrets (libsodium crypto_box_seal) ──
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function getX25519SharedSecret(recipientPubKeyBytes) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const epkDer = publicKey.export({ type: "spki", format: "der" });
  const epkBytes = epkDer.subarray(epkDer.length - 32);

  const recipientKeyObject = crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, recipientPubKeyBytes]),
    format: "der",
    type: "spki"
  });

  const sharedSecret = crypto.diffieHellman({
    privateKey,
    publicKey: recipientKeyObject
  });

  return { epkBytes, sharedSecret };
}

function rotl32(v, n) {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

const SIGMA_SALSA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

function hsalsa20(input16, key32) {
  const x = new Uint32Array(16);
  x[0] = SIGMA_SALSA[0];
  x[1] = key32.readUInt32LE(0);
  x[2] = key32.readUInt32LE(4);
  x[3] = key32.readUInt32LE(8);
  x[4] = key32.readUInt32LE(12);
  x[5] = SIGMA_SALSA[1];
  x[6] = input16.readUInt32LE(0);
  x[7] = input16.readUInt32LE(4);
  x[8] = input16.readUInt32LE(8);
  x[9] = input16.readUInt32LE(12);
  x[10] = SIGMA_SALSA[2];
  x[11] = key32.readUInt32LE(16);
  x[12] = key32.readUInt32LE(20);
  x[13] = key32.readUInt32LE(24);
  x[14] = key32.readUInt32LE(28);
  x[15] = SIGMA_SALSA[3];

  for (let i = 0; i < 20; i += 2) {
    x[4] ^= rotl32((x[0] + x[12]) >>> 0, 7);
    x[8] ^= rotl32((x[4] + x[0]) >>> 0, 9);
    x[12] ^= rotl32((x[8] + x[4]) >>> 0, 13);
    x[0] ^= rotl32((x[12] + x[8]) >>> 0, 18);
    x[9] ^= rotl32((x[5] + x[1]) >>> 0, 7);
    x[13] ^= rotl32((x[9] + x[5]) >>> 0, 9);
    x[1] ^= rotl32((x[13] + x[9]) >>> 0, 13);
    x[5] ^= rotl32((x[1] + x[13]) >>> 0, 18);
    x[14] ^= rotl32((x[10] + x[6]) >>> 0, 7);
    x[2] ^= rotl32((x[14] + x[10]) >>> 0, 9);
    x[6] ^= rotl32((x[2] + x[14]) >>> 0, 13);
    x[10] ^= rotl32((x[6] + x[2]) >>> 0, 18);
    x[3] ^= rotl32((x[15] + x[11]) >>> 0, 7);
    x[7] ^= rotl32((x[3] + x[15]) >>> 0, 9);
    x[11] ^= rotl32((x[7] + x[3]) >>> 0, 13);
    x[15] ^= rotl32((x[11] + x[7]) >>> 0, 18);

    x[1] ^= rotl32((x[0] + x[3]) >>> 0, 7);
    x[2] ^= rotl32((x[1] + x[0]) >>> 0, 9);
    x[3] ^= rotl32((x[2] + x[1]) >>> 0, 13);
    x[0] ^= rotl32((x[3] + x[2]) >>> 0, 18);
    x[6] ^= rotl32((x[5] + x[4]) >>> 0, 7);
    x[7] ^= rotl32((x[6] + x[5]) >>> 0, 9);
    x[4] ^= rotl32((x[7] + x[6]) >>> 0, 13);
    x[5] ^= rotl32((x[4] + x[7]) >>> 0, 18);
    x[11] ^= rotl32((x[10] + x[9]) >>> 0, 7);
    x[8] ^= rotl32((x[11] + x[10]) >>> 0, 9);
    x[9] ^= rotl32((x[8] + x[11]) >>> 0, 13);
    x[10] ^= rotl32((x[9] + x[8]) >>> 0, 18);
    x[12] ^= rotl32((x[15] + x[14]) >>> 0, 7);
    x[13] ^= rotl32((x[12] + x[15]) >>> 0, 9);
    x[14] ^= rotl32((x[13] + x[12]) >>> 0, 13);
    x[15] ^= rotl32((x[14] + x[13]) >>> 0, 18);
  }

  const out = Buffer.alloc(32);
  out.writeUInt32LE(x[0], 0);
  out.writeUInt32LE(x[5], 4);
  out.writeUInt32LE(x[10], 8);
  out.writeUInt32LE(x[15], 12);
  out.writeUInt32LE(x[6], 16);
  out.writeUInt32LE(x[7], 20);
  out.writeUInt32LE(x[8], 24);
  out.writeUInt32LE(x[9], 28);
  return out;
}

function salsa20Block(key32, nonce8, counter8) {
  const inBuf = new Uint32Array(16);
  inBuf[0] = SIGMA_SALSA[0];
  inBuf[1] = key32.readUInt32LE(0);
  inBuf[2] = key32.readUInt32LE(4);
  inBuf[3] = key32.readUInt32LE(8);
  inBuf[4] = key32.readUInt32LE(12);
  inBuf[5] = SIGMA_SALSA[1];
  inBuf[6] = nonce8.readUInt32LE(0);
  inBuf[7] = nonce8.readUInt32LE(4);
  inBuf[8] = counter8.readUInt32LE(0);
  inBuf[9] = counter8.readUInt32LE(4);
  inBuf[10] = SIGMA_SALSA[2];
  inBuf[11] = key32.readUInt32LE(16);
  inBuf[12] = key32.readUInt32LE(20);
  inBuf[13] = key32.readUInt32LE(24);
  inBuf[14] = key32.readUInt32LE(28);
  inBuf[15] = SIGMA_SALSA[3];

  const x = new Uint32Array(inBuf);
  for (let i = 0; i < 20; i += 2) {
    x[4] ^= rotl32((x[0] + x[12]) >>> 0, 7);
    x[8] ^= rotl32((x[4] + x[0]) >>> 0, 9);
    x[12] ^= rotl32((x[8] + x[4]) >>> 0, 13);
    x[0] ^= rotl32((x[12] + x[8]) >>> 0, 18);
    x[9] ^= rotl32((x[5] + x[1]) >>> 0, 7);
    x[13] ^= rotl32((x[9] + x[5]) >>> 0, 9);
    x[1] ^= rotl32((x[13] + x[9]) >>> 0, 13);
    x[5] ^= rotl32((x[1] + x[13]) >>> 0, 18);
    x[14] ^= rotl32((x[10] + x[6]) >>> 0, 7);
    x[2] ^= rotl32((x[14] + x[10]) >>> 0, 9);
    x[6] ^= rotl32((x[2] + x[14]) >>> 0, 13);
    x[10] ^= rotl32((x[6] + x[2]) >>> 0, 18);
    x[3] ^= rotl32((x[15] + x[11]) >>> 0, 7);
    x[7] ^= rotl32((x[3] + x[15]) >>> 0, 9);
    x[11] ^= rotl32((x[7] + x[3]) >>> 0, 13);
    x[15] ^= rotl32((x[11] + x[7]) >>> 0, 18);

    x[1] ^= rotl32((x[0] + x[3]) >>> 0, 7);
    x[2] ^= rotl32((x[1] + x[0]) >>> 0, 9);
    x[3] ^= rotl32((x[2] + x[1]) >>> 0, 13);
    x[0] ^= rotl32((x[3] + x[2]) >>> 0, 18);
    x[6] ^= rotl32((x[5] + x[4]) >>> 0, 7);
    x[7] ^= rotl32((x[6] + x[5]) >>> 0, 9);
    x[4] ^= rotl32((x[7] + x[6]) >>> 0, 13);
    x[5] ^= rotl32((x[4] + x[7]) >>> 0, 18);
    x[11] ^= rotl32((x[10] + x[9]) >>> 0, 7);
    x[8] ^= rotl32((x[11] + x[10]) >>> 0, 9);
    x[9] ^= rotl32((x[8] + x[11]) >>> 0, 13);
    x[10] ^= rotl32((x[9] + x[8]) >>> 0, 18);
    x[12] ^= rotl32((x[15] + x[14]) >>> 0, 7);
    x[13] ^= rotl32((x[12] + x[15]) >>> 0, 9);
    x[14] ^= rotl32((x[13] + x[12]) >>> 0, 13);
    x[15] ^= rotl32((x[14] + x[13]) >>> 0, 18);
  }

  const out = Buffer.alloc(64);
  for (let i = 0; i < 16; i++) {
    out.writeUInt32LE((x[i] + inBuf[i]) >>> 0, i * 4);
  }
  return out;
}

function poly1305(msg, key32) {
  const q = (1n << 130n) - 5n;
  const rBuf = Buffer.from(key32.subarray(0, 16));
  rBuf[3] &= 15; rBuf[7] &= 15; rBuf[11] &= 15; rBuf[15] &= 15;
  rBuf[4] &= 252; rBuf[8] &= 252; rBuf[12] &= 252;

  let r = 0n;
  for (let i = 15; i >= 0; i--) r = (r << 8n) | BigInt(rBuf[i]);
  let s = 0n;
  for (let i = 31; i >= 16; i--) s = (s << 8n) | BigInt(key32[i]);

  let acc = 0n;
  for (let i = 0; i < msg.length; i += 16) {
    const chunk = msg.subarray(i, Math.min(i + 16, msg.length));
    let n = 0n;
    for (let j = chunk.length - 1; j >= 0; j--) n = (n << 8n) | BigInt(chunk[j]);
    n |= (1n << BigInt(8 * chunk.length));
    acc = ((acc + n) * r) % q;
  }
  acc = (acc + s) % (1n << 128n);

  const tag = Buffer.alloc(16);
  let temp = acc;
  for (let i = 0; i < 16; i++) {
    tag[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return tag;
}

function blake2b24(input) {
  const IV = [
    0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn,
    0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn,
    0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n
  ];
  const SIGMA = [
    [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
    [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],
    [11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],
    [7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],
    [9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],
    [2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],
    [12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],
    [13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],
    [6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],
    [10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0],
    [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
    [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3]
  ];

  function rotR(x, n) {
    const shift = BigInt(n);
    return ((x >> shift) | (x << (64n - shift))) & 0xffffffffffffffffn;
  }

  const h = [...IV];
  h[0] ^= 0x01010018n;

  const block = Buffer.alloc(128);
  input.copy(block, 0);

  const m = new Array(16);
  for (let i = 0; i < 16; i++) {
    m[i] = block.readBigUInt64LE(i * 8);
  }

  const v = new Array(16);
  for (let i = 0; i < 8; i++) v[i] = h[i];
  for (let i = 0; i < 8; i++) v[i + 8] = IV[i];
  v[12] ^= BigInt(input.length);
  v[14] ^= 0xffffffffffffffffn;

  function g(a, b, c, d, xVal, yVal) {
    v[a] = (v[a] + v[b] + xVal) & 0xffffffffffffffffn;
    v[d] = rotR(v[d] ^ v[a], 32);
    v[c] = (v[c] + v[d]) & 0xffffffffffffffffn;
    v[b] = rotR(v[b] ^ v[c], 24);
    v[a] = (v[a] + v[b] + yVal) & 0xffffffffffffffffn;
    v[d] = rotR(v[d] ^ v[a], 16);
    v[c] = (v[c] + v[d]) & 0xffffffffffffffffn;
    v[b] = rotR(v[b] ^ v[c], 63);
  }

  for (let r = 0; r < 12; r++) {
    const s = SIGMA[r];
    g(0, 4, 8, 12, m[s[0]], m[s[1]]);
    g(1, 5, 9, 13, m[s[2]], m[s[3]]);
    g(2, 6, 10, 14, m[s[4]], m[s[5]]);
    g(3, 7, 11, 15, m[s[6]], m[s[7]]);
    g(0, 5, 10, 15, m[s[8]], m[s[9]]);
    g(1, 6, 11, 12, m[s[10]], m[s[11]]);
    g(2, 7, 8, 13, m[s[12]], m[s[13]]);
    g(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }

  for (let i = 0; i < 8; i++) {
    h[i] ^= v[i] ^ v[i + 8];
  }

  const out = Buffer.alloc(24);
  out.writeBigUInt64LE(h[0], 0);
  out.writeBigUInt64LE(h[1], 8);
  out.writeBigUInt64LE(h[2], 16);
  return out;
}

function sealSecret(secretText, recipientPubKeyB64) {
  const recipientPubKey = Buffer.from(recipientPubKeyB64, "base64");
  const { epkBytes, sharedSecret } = getX25519SharedSecret(recipientPubKey);

  const kBox = hsalsa20(Buffer.alloc(16, 0), sharedSecret);
  const nonce = blake2b24(Buffer.concat([epkBytes, recipientPubKey]));

  const subkey = hsalsa20(nonce.subarray(0, 16), kBox);
  const subnonce = nonce.subarray(16, 24);

  const msgBytes = Buffer.from(secretText, "utf8");
  const counter0 = Buffer.alloc(8, 0);
  const block0 = salsa20Block(subkey, subnonce, counter0);
  const polyKey = block0.subarray(0, 32);

  const cipher = Buffer.alloc(msgBytes.length);
  let pos = 0;
  let blockIdx = 1;
  while (pos < msgBytes.length) {
    const ctr = Buffer.alloc(8, 0);
    ctr.writeBigUInt64LE(BigInt(blockIdx), 0);
    const blk = salsa20Block(subkey, subnonce, ctr);
    const take = Math.min(blk.length, msgBytes.length - pos);
    for (let j = 0; j < take; j++) {
      cipher[pos + j] = msgBytes[pos + j] ^ blk[j];
    }
    pos += take;
    blockIdx++;
  }

  const tag = poly1305(cipher, polyKey);
  const sealed = Buffer.concat([epkBytes, tag, cipher]);
  return sealed.toString("base64");
}



export function register({ server, z, getSettings, log, fetchJson }) {
  server = guardedServer(server, "github", getSettings, []);
  const makeHeaders = (pat) => ({
    "Authorization": `Bearer ${pat}`,
    "User-Agent": "MCP-Station-GitHub-Module",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  });

  const getClient = () => {
    const { pat, default_owner } = getSettings();
    if (!pat) {
      throw new Error("Missing GitHub Personal Access Token (pat) in settings. Please configure it in Settings.");
    }
    return { pat, default_owner };
  };

  const request = async (method, path, body = null) => {
    const { pat } = getClient();
    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    const options = {
      method,
      headers: makeHeaders(pat)
    };
    if (body) {
      options.body = JSON.stringify(body);
      options.headers["Content-Type"] = "application/json";
    }
    return await fetchJson(url, options);
  };

  // Helper to resolve owner/repo
  const parseRepo = (repoParam, default_owner) => {
    if (repoParam.includes("/")) {
      const [owner, repo] = repoParam.split("/");
      return { owner, repo };
    }
    if (!default_owner) {
      throw new Error(`Repository must be in 'owner/repo' format or a Default Owner must be configured in settings.`);
    }
    return { owner: default_owner, repo: repoParam };
  };

  // Encode a repo path per segment — encodeURIComponent() on the whole path
  // turns '/' into '%2F' and every nested file 404s.
  const encodePath = (p) =>
    String(p || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");

  // Build a query string from defined values only.
  const qs = (params) => {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  // structuredContent must be a JSON object — never a bare array.
  const structured = (data) => (Array.isArray(data) ? { items: data } : data);

  const ok = (text, data) => ({
    content: [{ type: "text", text }],
    structuredContent: structured(data)
  });

  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }] });

  // Resolve owner/repo and return the API prefix in one step.
  const repoBase = (repository) => {
    const { default_owner } = getClient();
    const { owner, repo } = parseRepo(repository, default_owner);
    return { owner, repo, base: `/repos/${owner}/${repo}` };
  };

  // ── Identity & quota ──────────────────────────────────────────────

  server.registerTool(
    "github_get_me",
    {
      title: "Get authenticated user",
      description: "Return the account the configured PAT belongs to, plus current API rate limit. Use this first when diagnosing auth problems.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      try {
        const user = await request("GET", "/user");
        let rate = null;
        try {
          const r = await request("GET", "/rate_limit");
          rate = r.resources?.core;
        } catch (e) { /* rate_limit is non-essential */ }
        const summary =
          `Authenticated as ${user.login} (${user.name || "no name"})\n` +
          `Type: ${user.type} · public repos: ${user.public_repos} · private: ${user.total_private_repos ?? "n/a"}\n` +
          (rate ? `Rate limit: ${rate.remaining}/${rate.limit}, resets ${new Date(rate.reset * 1000).toISOString()}` : "");
        return ok(summary, { user, rate });
      } catch (e) { return fail(e); }
    }
  );

  // ── Repositories ──────────────────────────────────────────────────

  server.registerTool(
    "github_create_repository",
    {
      title: "Create repository",
      description: "Create a new GitHub repository for the authenticated user or in an organization.",
      inputSchema: {
        name: z.string().describe("The name of the new repository"),
        description: z.string().optional().describe("A short description of the repository"),
        private: z.boolean().default(false).describe("Whether the repository is private (default: false)"),
        org: z.string().optional().describe("Organization name if creating in an organization instead of personal account"),
        auto_init: z.boolean().default(true).describe("Initialize with a README.md so the repo can be cloned immediately (default: true)"),
        gitignore_template: z.string().optional().describe("Language for .gitignore template (e.g. 'Node', 'Python', 'Go')"),
        license_template: z.string().optional().describe("License template keyword (e.g. 'mit', 'apache-2.0', 'gpl-3.0')")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ name, description, private: isPrivate, org, auto_init, gitignore_template, license_template }) => {
      try {
        const payload = {
          name,
          private: isPrivate,
          auto_init
        };
        if (description) payload.description = description;
        if (gitignore_template) payload.gitignore_template = gitignore_template;
        if (license_template) payload.license_template = license_template;

        const path = org ? `/orgs/${encodeURIComponent(org)}/repos` : "/user/repos";
        const data = await request("POST", path, payload);

        const summary =
          `Successfully created repository ${data.full_name} (${data.private ? "private" : "public"})\n` +
          `• URL: ${data.html_url}\n` +
          `• Clone HTTPS: ${data.clone_url}\n` +
          `• Clone SSH:   ${data.ssh_url}\n` +
          `• Default branch: ${data.default_branch || "main"}`;

        return ok(summary, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_search_repositories",
    {
      title: "Search repositories",
      description: "Search for GitHub repositories matching a query.",
      inputSchema: {
        query: z.string().describe("Search query (e.g. 'mcp-server language:javascript')"),
        per_page: z.number().int().min(1).max(100).default(10).describe("Number of results to return"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ query, per_page, page }) => {
      try {
        const data = await request("GET", `/search/repositories${qs({ q: query, per_page, page })}`);
        const repos = data.items.map(item => ({
          full_name: item.full_name,
          description: item.description,
          stars: item.stargazers_count,
          forks: item.forks_count,
          language: item.language,
          html_url: item.html_url
        }));
        return ok(`Found ${data.total_count} repositories. Showing page ${page}.\n\n` + JSON.stringify(repos, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_list_my_repositories",
    {
      title: "List my repositories",
      description: "List repositories the authenticated user can access, including private ones.",
      inputSchema: {
        visibility: z.enum(["all", "public", "private"]).default("all").describe("Filter by visibility"),
        affiliation: z.string().default("owner,collaborator,organization_member").describe("Comma-separated: owner, collaborator, organization_member"),
        sort: z.enum(["created", "updated", "pushed", "full_name"]).default("updated").describe("Sort field"),
        per_page: z.number().int().min(1).max(100).default(30).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ visibility, affiliation, sort, per_page, page }) => {
      try {
        const data = await request("GET", `/user/repos${qs({ visibility, affiliation, sort, per_page, page })}`);
        const repos = data.map(r => ({
          full_name: r.full_name,
          private: r.private,
          description: r.description,
          default_branch: r.default_branch,
          language: r.language,
          stars: r.stargazers_count,
          open_issues: r.open_issues_count,
          pushed_at: r.pushed_at,
          html_url: r.html_url
        }));
        return ok(`${repos.length} repositories (page ${page}):\n\n` + JSON.stringify(repos, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_get_repository",
    {
      title: "Get repository",
      description: "Get metadata for a single repository — default branch, topics, permissions, counts.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository }) => {
      try {
        const { base } = repoBase(repository);
        const r = await request("GET", base);
        const summary = {
          full_name: r.full_name,
          description: r.description,
          private: r.private,
          default_branch: r.default_branch,
          language: r.language,
          topics: r.topics,
          stars: r.stargazers_count,
          forks: r.forks_count,
          open_issues: r.open_issues_count,
          archived: r.archived,
          permissions: r.permissions,
          html_url: r.html_url
        };
        return ok(JSON.stringify(summary, null, 2), r);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_create_fork",
    {
      title: "Fork repository",
      description: "Fork a repository to the authenticated user's account or to an organization. Returns new repository URLs and clone commands.",
      inputSchema: {
        repository: z.string().describe("Repository to fork ('owner/repo')"),
        organization: z.string().optional().describe("Target organization to fork into (omit to fork into your personal account)"),
        default_branch_only: z.boolean().default(false).describe("Only fork the default branch (default: false, forks all branches)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, organization, default_branch_only }) => {
      try {
        const { base } = repoBase(repository);
        const payload = { default_branch_only };
        if (organization) payload.organization = organization;
        const data = await request("POST", `${base}/forks`, payload);
        return ok(
          `Fork created/queued: ${data.full_name}\n` +
          `• URL: ${data.html_url}\n` +
          `• Clone HTTPS: ${data.clone_url}\n` +
          `• Clone SSH:   ${data.ssh_url}`,
          data
        );
      } catch (e) { return fail(e); }
    }
  );

  // ── Branches & commits ────────────────────────────────────────────

  server.registerTool(
    "github_list_branches",
    {
      title: "List branches",
      description: "List branches in a repository, showing which are protected.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        per_page: z.number().int().min(1).max(100).default(50).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, per_page, page }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/branches${qs({ per_page, page })}`);
        const branches = data.map(b => ({ name: b.name, sha: b.commit?.sha, protected: b.protected }));
        return ok(`Branches in ${owner}/${repo}:\n\n` + JSON.stringify(branches, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_create_branch",
    {
      title: "Create branch",
      description: "Create a new branch from an existing one. Resolves the source branch's head SHA automatically.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        branch: z.string().describe("Name of the new branch (without 'refs/heads/')"),
        from_branch: z.string().optional().describe("Source branch. Default: the repository's default branch.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, branch, from_branch }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        let source = from_branch;
        if (!source) {
          const r = await request("GET", base);
          source = r.default_branch;
        }
        const ref = await request("GET", `${base}/git/ref/heads/${encodePath(source)}`);
        const sha = ref.object?.sha;
        if (!sha) throw new Error(`Could not resolve head SHA for branch '${source}'`);
        const data = await request("POST", `${base}/git/refs`, { ref: `refs/heads/${branch}`, sha });
        return ok(`Created branch '${branch}' in ${owner}/${repo} from '${source}' at ${sha.slice(0, 7)}`, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_delete_branch",
    {
      title: "Delete branch",
      description: "Delete a branch from a repository. Useful for cleaning up merged feature branches.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        branch: z.string().describe("Name of the branch to delete (without 'refs/heads/')")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, branch }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        await request("DELETE", `${base}/git/refs/heads/${encodePath(branch)}`);
        return ok(`Deleted branch '${branch}' from ${owner}/${repo}.`, { repository: `${owner}/${repo}`, branch, deleted: true });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_list_commits",
    {
      title: "List commits",
      description: "List commits on a branch, optionally filtered by path or author.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        sha: z.string().optional().describe("Branch name or commit SHA to start from. Default: default branch."),
        path: z.string().optional().describe("Only commits touching this file path"),
        author: z.string().optional().describe("Filter by GitHub username or email"),
        since: z.string().optional().describe("ISO 8601 timestamp — only commits after this"),
        per_page: z.number().int().min(1).max(100).default(20).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, sha, path: filePath, author, since, per_page, page }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/commits${qs({ sha, path: filePath, author, since, per_page, page })}`);
        const commits = data.map(c => ({
          sha: c.sha?.slice(0, 7),
          full_sha: c.sha,
          message: (c.commit?.message || "").split("\n")[0],
          author: c.commit?.author?.name,
          date: c.commit?.author?.date,
          html_url: c.html_url
        }));
        return ok(`Commits in ${owner}/${repo} (page ${page}):\n\n` + JSON.stringify(commits, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_compare_commits",
    {
      title: "Compare commits or branches",
      description: "Compare two commits, branches or tags — returns the changed files and ahead/behind counts. Use this to review what a branch would merge.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        base_ref: z.string().describe("The base branch/commit (e.g. 'main')"),
        head_ref: z.string().describe("The head branch/commit to compare against base")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, base_ref, head_ref }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/compare/${encodeURIComponent(base_ref)}...${encodeURIComponent(head_ref)}`);
        const summary = {
          status: data.status,
          ahead_by: data.ahead_by,
          behind_by: data.behind_by,
          total_commits: data.total_commits,
          files: (data.files || []).map(f => ({
            filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions
          }))
        };
        return ok(`${owner}/${repo}: ${base_ref}...${head_ref}\n\n` + JSON.stringify(summary, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_get_commit",
    {
      title: "Get commit details",
      description: "Get detailed information for a specific commit SHA or branch/tag reference, including commit message, author, stats, and changed files with diff patches.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        ref: z.string().describe("Commit SHA, branch name, or tag name")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, ref }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/commits/${encodeURIComponent(ref)}`);
        const summary = {
          sha: data.sha,
          message: data.commit?.message,
          author: `${data.commit?.author?.name} <${data.commit?.author?.email}>`,
          date: data.commit?.author?.date,
          stats: data.stats,
          files: (data.files || []).map(f => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch
          }))
        };
        const text = `Commit ${data.sha?.slice(0, 7)} in ${owner}/${repo}:\n` +
          `Author: ${summary.author} (${summary.date})\n` +
          `Message: ${summary.message}\n` +
          `Stats: +${data.stats?.additions || 0} / -${data.stats?.deletions || 0} across ${summary.files.length} files\n\n` +
          JSON.stringify(summary, null, 2);
        return ok(text, data);
      } catch (e) { return fail(e); }
    }
  );

  // ── Issues ────────────────────────────────────────────────────────

  server.registerTool(
    "github_list_issues",
    {
      title: "List repository issues",
      description: "List open or closed issues/pull requests in a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        state: z.enum(["open", "closed", "all"]).default("open").describe("Issue state"),
        per_page: z.number().int().min(1).max(100).default(20).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, state, per_page, page }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/issues${qs({ state, per_page, page })}`);
        const issues = data.map(issue => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          html_url: issue.html_url,
          user: issue.user?.login,
          pull_request: !!issue.pull_request,
          created_at: issue.created_at,
          comments_count: issue.comments
        }));
        return ok(`Issues for ${owner}/${repo} (Page ${page}, State: ${state}):\n\n` + JSON.stringify(issues, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_create_issue",
    {
      title: "Create issue",
      description: "Create a new issue in a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        title: z.string().describe("The title of the issue"),
        body: z.string().optional().describe("The description / body of the issue"),
        labels: z.array(z.string()).optional().describe("Labels to associate with this issue")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, title, body, labels }) => {
      try {
        const { base } = repoBase(repository);
        const payload = { title };
        if (body) payload.body = body;
        if (labels) payload.labels = labels;
        const data = await request("POST", `${base}/issues`, payload);
        return ok(`Successfully created issue #${data.number}: "${data.title}"\nURL: ${data.html_url}`, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_update_issue",
    {
      title: "Update issue",
      description: "Edit an issue — change title, body, labels, assignees, or close/reopen it.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        issue_number: z.number().int().describe("The issue number"),
        title: z.string().optional().describe("New title"),
        body: z.string().optional().describe("New body"),
        state: z.enum(["open", "closed"]).optional().describe("Close or reopen the issue"),
        state_reason: z.enum(["completed", "not_planned", "reopened"]).optional().describe("Why the state changed"),
        labels: z.array(z.string()).optional().describe("Replace labels with this set"),
        assignees: z.array(z.string()).optional().describe("Replace assignees with these usernames")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, issue_number, title, body, state, state_reason, labels, assignees }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const payload = {};
        if (title !== undefined) payload.title = title;
        if (body !== undefined) payload.body = body;
        if (state !== undefined) payload.state = state;
        if (state_reason !== undefined) payload.state_reason = state_reason;
        if (labels !== undefined) payload.labels = labels;
        if (assignees !== undefined) payload.assignees = assignees;
        if (!Object.keys(payload).length) throw new Error("Nothing to update — supply at least one field.");
        const data = await request("PATCH", `${base}/issues/${issue_number}`, payload);
        return ok(`Updated issue #${data.number} in ${owner}/${repo} — state: ${data.state}\n${data.html_url}`, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_add_issue_comment",
    {
      title: "Comment on issue or PR",
      description: "Add a comment to an issue or pull request. PRs share the issue comment endpoint.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        issue_number: z.number().int().describe("Issue or pull request number"),
        body: z.string().describe("The comment text (Markdown)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, issue_number, body }) => {
      try {
        const { base } = repoBase(repository);
        const data = await request("POST", `${base}/issues/${issue_number}/comments`, { body });
        return ok(`Comment posted on #${issue_number}\n${data.html_url}`, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_list_issue_comments",
    {
      title: "List issue comments",
      description: "List comments on an issue or pull request.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        issue_number: z.number().int().describe("Issue or pull request number"),
        per_page: z.number().int().min(1).max(100).default(30).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, issue_number, per_page, page }) => {
      try {
        const { base } = repoBase(repository);
        const data = await request("GET", `${base}/issues/${issue_number}/comments${qs({ per_page, page })}`);
        const comments = data.map(c => ({
          user: c.user?.login, created_at: c.created_at, body: c.body, html_url: c.html_url
        }));
        return ok(`${comments.length} comments on #${issue_number}:\n\n` + JSON.stringify(comments, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  // ── Pull requests ─────────────────────────────────────────────────

  server.registerTool(
    "github_create_pull_request",
    {
      title: "Create pull request",
      description: "Create a new pull request in a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        title: z.string().describe("The title of the pull request"),
        head: z.string().describe("The branch containing your changes (e.g. 'feature-branch')"),
        base: z.string().describe("The branch to pull changes into (e.g. 'main')"),
        body: z.string().optional().describe("The pull request description")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, title, head, base: baseBranch, body }) => {
      try {
        const { base } = repoBase(repository);
        const payload = { title, head, base: baseBranch };
        if (body) payload.body = body;
        const data = await request("POST", `${base}/pulls`, payload);
        return ok(`Successfully created PR #${data.number}: "${data.title}"\nURL: ${data.html_url}\nState: ${data.state}`, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_update_pull_request",
    {
      title: "Update pull request",
      description: "Update a pull request's title, body, state (open/closed), or target base branch.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        pull_number: z.number().int().describe("The pull request number"),
        title: z.string().optional().describe("New title for the pull request"),
        body: z.string().optional().describe("New description / body for the pull request"),
        state: z.enum(["open", "closed"]).optional().describe("Change state to 'open' or 'closed'"),
        base: z.string().optional().describe("The name of the branch you want your changes pulled into")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, pull_number, title, body, state, base: baseBranch }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const payload = {};
        if (title !== undefined) payload.title = title;
        if (body !== undefined) payload.body = body;
        if (state !== undefined) payload.state = state;
        if (baseBranch !== undefined) payload.base = baseBranch;
        if (!Object.keys(payload).length) throw new Error("Nothing to update — supply at least one field.");
        const data = await request("PATCH", `${base}/pulls/${pull_number}`, payload);
        return ok(`Updated PR #${data.number} in ${owner}/${repo} — state: ${data.state}\n${data.html_url}`, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_list_pull_requests",
    {
      title: "List pull requests",
      description: "List pull requests in a repository, filtered by state, base or head branch.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        state: z.enum(["open", "closed", "all"]).default("open").describe("PR state"),
        base_branch: z.string().optional().describe("Only PRs targeting this branch"),
        sort: z.enum(["created", "updated", "popularity", "long-running"]).default("created").describe("Sort field"),
        direction: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
        per_page: z.number().int().min(1).max(100).default(20).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, state, base_branch, sort, direction, per_page, page }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/pulls${qs({ state, base: base_branch, sort, direction, per_page, page })}`);
        const prs = data.map(p => ({
          number: p.number,
          title: p.title,
          state: p.state,
          draft: p.draft,
          user: p.user?.login,
          head: p.head?.ref,
          base: p.base?.ref,
          created_at: p.created_at,
          html_url: p.html_url
        }));
        return ok(`Pull requests in ${owner}/${repo} (${state}, page ${page}):\n\n` + JSON.stringify(prs, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_get_pull_request",
    {
      title: "Get pull request",
      description: "Get a single pull request with mergeability, review state and diff size.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        pull_number: z.number().int().describe("The pull request number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, pull_number }) => {
      try {
        const { base } = repoBase(repository);
        const p = await request("GET", `${base}/pulls/${pull_number}`);
        const summary = {
          number: p.number,
          title: p.title,
          state: p.state,
          draft: p.draft,
          user: p.user?.login,
          head: p.head?.ref,
          base: p.base?.ref,
          mergeable: p.mergeable,
          mergeable_state: p.mergeable_state,
          merged: p.merged,
          commits: p.commits,
          changed_files: p.changed_files,
          additions: p.additions,
          deletions: p.deletions,
          html_url: p.html_url
        };
        return ok(JSON.stringify(summary, null, 2), p);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_list_pull_request_files",
    {
      title: "List pull request files",
      description: "List the files changed by a pull request, with per-file patches. Use this to review a PR's actual diff.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        pull_number: z.number().int().describe("The pull request number"),
        include_patch: z.boolean().default(false).describe("Include the diff hunk for each file. Large PRs get very long."),
        per_page: z.number().int().min(1).max(100).default(50).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, pull_number, include_patch, per_page, page }) => {
      try {
        const { base } = repoBase(repository);
        const data = await request("GET", `${base}/pulls/${pull_number}/files${qs({ per_page, page })}`);
        const files = data.map(f => {
          const row = {
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            changes: f.changes
          };
          if (include_patch && f.patch) row.patch = f.patch;
          return row;
        });
        const totals = files.reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 });
        return ok(`PR #${pull_number}: ${files.length} files, +${totals.add} / -${totals.del}\n\n` + JSON.stringify(files, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_create_pull_request_review",
    {
      title: "Review a pull request",
      description: "Approve, request changes on, or comment on a pull request.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        pull_number: z.number().int().describe("The pull request number"),
        event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("The review verdict"),
        body: z.string().optional().describe("Review body. Required for REQUEST_CHANGES and COMMENT.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, pull_number, event, body }) => {
      try {
        if ((event === "REQUEST_CHANGES" || event === "COMMENT") && !body) {
          throw new Error(`A body is required when event is ${event}.`);
        }
        const { base } = repoBase(repository);
        const payload = { event };
        if (body) payload.body = body;
        const data = await request("POST", `${base}/pulls/${pull_number}/reviews`, payload);
        return ok(`Review submitted on #${pull_number}: ${event}\n${data.html_url || ""}`, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_merge_pull_request",
    {
      title: "Merge pull request",
      description: "Merge a pull request. This writes to the base branch and cannot be undone with a single call.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        pull_number: z.number().int().describe("The pull request number"),
        merge_method: z.enum(["merge", "squash", "rebase"]).default("merge").describe("How to merge"),
        commit_title: z.string().optional().describe("Override the merge commit title"),
        commit_message: z.string().optional().describe("Override the merge commit body")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, pull_number, merge_method, commit_title, commit_message }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const payload = { merge_method };
        if (commit_title) payload.commit_title = commit_title;
        if (commit_message) payload.commit_message = commit_message;
        const data = await request("PUT", `${base}/pulls/${pull_number}/merge`, payload);
        return ok(`Merged PR #${pull_number} into ${owner}/${repo} (${merge_method})\nSHA: ${data.sha}\n${data.message}`, data);
      } catch (e) { return fail(e); }
    }
  );

  // ── Files ─────────────────────────────────────────────────────────

  server.registerTool(
    "github_get_file_contents",
    {
      title: "Get file contents",
      description: "Retrieve the contents of a file in a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        path: z.string().describe("The path to the file (e.g. 'src/index.js' or 'README.md')"),
        ref: z.string().optional().describe("The name of the commit/branch/tag. Default: the repository's default branch.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, path: filePath, ref }) => {
      try {
        const { base } = repoBase(repository);
        const path = `${base}/contents/${encodePath(filePath)}${qs({ ref })}`;
        const data = await request("GET", path);

        if (data.type === "dir" || Array.isArray(data)) {
          return { content: [{ type: "text", text: `Error: Specified path is a directory. Use github_list_directory instead.` }] };
        }

        if (data.encoding === "base64") {
          const content = Buffer.from(data.content, "base64").toString("utf8");
          return ok(content, data);
        }

        return ok(data.content || "", data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_create_or_update_file",
    {
      title: "Create or update file",
      description: "Create or update a file in a repository. This creates a commit. If the file exists and no SHA is given, its contents are overwritten.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        path: z.string().describe("The path to the file to create/update (e.g. 'src/index.js')"),
        content: z.string().describe("The new contents of the file"),
        message: z.string().describe("The commit message"),
        branch: z.string().optional().describe("The branch name. Default: the repository's default branch."),
        sha: z.string().optional().describe("The blob SHA of the file being replaced. Resolved automatically if omitted.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, path: filePath, content, message, branch, sha }) => {
      try {
        const { base } = repoBase(repository);
        const path = `${base}/contents/${encodePath(filePath)}`;

        const base64Content = Buffer.from(content).toString("base64");
        const payload = { message, content: base64Content };
        if (branch) payload.branch = branch;
        if (sha) {
          payload.sha = sha;
        } else {
          // Attempt to fetch file to get SHA automatically if not provided
          try {
            const existingFile = await request("GET", `${path}${qs({ ref: branch })}`);
            if (existingFile && existingFile.sha) {
              payload.sha = existingFile.sha;
            }
          } catch (e) {
            // File likely doesn't exist yet; proceed without sha
          }
        }

        const data = await request("PUT", path, payload);
        return ok(`Successfully committed changes to ${filePath}.\nCommit: ${data.commit.sha}\nAuthor: ${data.commit.author.name}`, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_list_directory",
    {
      title: "List directory files",
      description: "List the files and directories inside a specific folder of a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        path: z.string().default("").describe("The path to the folder. Defaults to the repository root."),
        ref: z.string().optional().describe("The name of the commit/branch/tag. Default: the repository's default branch.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, path: folderPath, ref }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const path = `${base}/contents/${encodePath(folderPath)}${qs({ ref })}`;
        const data = await request("GET", path);

        if (!Array.isArray(data)) {
          return { content: [{ type: "text", text: `Error: Path is not a directory. Use github_get_file_contents for individual files.` }] };
        }

        const items = data.map(item => ({
          name: item.name,
          path: item.path,
          type: item.type, // 'file' or 'dir'
          sha: item.sha,
          size: item.size
        }));

        return ok(`Contents of directory '${folderPath}' in ${owner}/${repo}:\n\n` + JSON.stringify(items, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_delete_file",
    {
      title: "Delete file",
      description: "Delete a file from a repository. This creates a commit and removes content.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        path: z.string().describe("Path to the file to delete"),
        message: z.string().describe("The commit message"),
        branch: z.string().optional().describe("Branch to commit to. Default: the repository's default branch."),
        sha: z.string().optional().describe("Blob SHA of the file. Resolved automatically if omitted.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, path: filePath, message, branch, sha }) => {
      try {
        const { base } = repoBase(repository);
        const path = `${base}/contents/${encodePath(filePath)}`;
        let blobSha = sha;
        if (!blobSha) {
          const existing = await request("GET", `${path}${qs({ ref: branch })}`);
          if (Array.isArray(existing)) throw new Error("Path is a directory, not a file.");
          blobSha = existing.sha;
        }
        const payload = { message, sha: blobSha };
        if (branch) payload.branch = branch;
        const data = await request("DELETE", path, payload);
        return ok(`Deleted ${filePath}\nCommit: ${data.commit?.sha}`, data);
      } catch (e) { return fail(e); }
    }
  );

  // ── Actions ───────────────────────────────────────────────────────

  server.registerTool(
    "github_list_workflow_runs",
    {
      title: "List workflow runs",
      description: "List GitHub Actions runs, optionally filtered by workflow, branch or conclusion. Use this to check CI status.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        workflow: z.string().optional().describe("Workflow file name (e.g. 'ci.yml') or numeric ID. Omit for all workflows."),
        branch: z.string().optional().describe("Only runs on this branch"),
        status: z.enum(["queued", "in_progress", "completed", "success", "failure", "cancelled"]).optional().describe("Filter by status or conclusion"),
        per_page: z.number().int().min(1).max(100).default(10).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, workflow, branch, status, per_page, page }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const path = workflow
          ? `${base}/actions/workflows/${encodeURIComponent(workflow)}/runs`
          : `${base}/actions/runs`;
        const data = await request("GET", `${path}${qs({ branch, status, per_page, page })}`);
        const runs = (data.workflow_runs || []).map(r => ({
          id: r.id,
          name: r.name,
          branch: r.head_branch,
          event: r.event,
          status: r.status,
          conclusion: r.conclusion,
          created_at: r.created_at,
          html_url: r.html_url
        }));
        return ok(`Workflow runs for ${owner}/${repo} (${runs.length} of ${data.total_count}):\n\n` + JSON.stringify(runs, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_trigger_workflow",
    {
      title: "Trigger workflow",
      description: "Dispatch a GitHub Actions workflow manually. The workflow must have a 'workflow_dispatch' trigger.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        workflow: z.string().describe("Workflow file name (e.g. 'deploy.yml') or numeric ID"),
        ref: z.string().describe("Branch or tag to run the workflow on (e.g. 'main')"),
        inputs: z.record(z.string()).optional().describe("Workflow inputs as a flat key/value object")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, workflow, ref, inputs }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const wf = encodeURIComponent(workflow);

        // Note the newest existing run first, so we can tell a new one apart.
        let previousId = null;
        try {
          const before = await request("GET", `${base}/actions/workflows/${wf}/runs${qs({ per_page: 1 })}`);
          previousId = before.workflow_runs?.[0]?.id ?? null;
        } catch (e) { /* first-ever run, or no Actions read — not fatal */ }

        // This endpoint answers 204 No Content. Rather than depend on how the
        // host's fetchJson treats an empty body, dispatch then verify by polling.
        const payload = { ref };
        if (inputs) payload.inputs = inputs;
        let dispatchError = null;
        try {
          await request("POST", `${base}/actions/workflows/${wf}/dispatches`, payload);
        } catch (e) {
          dispatchError = e;
        }

        let run = null;
        for (let i = 0; i < 5 && !run; i++) {
          await new Promise(r => setTimeout(r, 1000));
          try {
            const after = await request("GET", `${base}/actions/workflows/${wf}/runs${qs({ per_page: 1 })}`);
            const newest = after.workflow_runs?.[0];
            if (newest && newest.id !== previousId) run = newest;
          } catch (e) { /* keep polling */ }
        }

        if (run) {
          return ok(
            `Dispatched '${workflow}' on ${owner}/${repo} @ ${ref}\n` +
            `Run #${run.run_number} (id ${run.id}) — ${run.status}\n${run.html_url}`,
            run
          );
        }

        // No new run appeared. If the POST also errored, that error is the real cause.
        if (dispatchError) throw dispatchError;
        return ok(
          `Dispatch accepted for '${workflow}' on ${owner}/${repo} @ ${ref}, but no new run appeared within 5s.\n` +
          `Check the workflow has a 'workflow_dispatch' trigger on ${ref}, then poll github_list_workflow_runs.`,
          { dispatched: true, confirmed: false, workflow, ref }
        );
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_rerun_workflow",
    {
      title: "Rerun workflow run",
      description: "Re-run a workflow run or only its failed jobs in GitHub Actions.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        run_id: z.number().int().describe("The ID of the workflow run"),
        failed_only: z.boolean().default(false).describe("Re-run only failed jobs instead of the entire workflow")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, run_id, failed_only }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const endpoint = failed_only
          ? `${base}/actions/runs/${run_id}/rerun-failed-jobs`
          : `${base}/actions/runs/${run_id}/rerun`;
        await request("POST", endpoint);
        return ok(`Triggered ${failed_only ? "failed jobs rerun" : "full rerun"} for workflow run #${run_id} in ${owner}/${repo}.`, {
          repository: `${owner}/${repo}`,
          run_id,
          failed_only
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── Search ────────────────────────────────────────────────────────

  server.registerTool(
    "github_search_code",
    {
      title: "Search code",
      description: "Search file contents across GitHub. Supports qualifiers like 'repo:owner/name', 'language:go', 'path:src'.",
      inputSchema: {
        query: z.string().describe("Search query (e.g. 'streamablehttp_client repo:ggml-org/llama.cpp')"),
        per_page: z.number().int().min(1).max(100).default(20).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ query, per_page, page }) => {
      try {
        const data = await request("GET", `/search/code${qs({ q: query, per_page, page })}`);
        const hits = (data.items || []).map(i => ({
          repository: i.repository?.full_name,
          path: i.path,
          html_url: i.html_url
        }));
        return ok(`${data.total_count} code matches (page ${page}):\n\n` + JSON.stringify(hits, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_search_issues",
    {
      title: "Search issues and pull requests",
      description: "Search issues and PRs across GitHub. Supports qualifiers like 'is:open', 'author:me', 'repo:owner/name', 'label:bug'.",
      inputSchema: {
        query: z.string().describe("Search query (e.g. 'is:open is:pr author:example-user')"),
        sort: z.enum(["comments", "created", "updated"]).optional().describe("Sort field. Default: best match."),
        order: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
        per_page: z.number().int().min(1).max(100).default(20).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ query, sort, order, per_page, page }) => {
      try {
        const data = await request("GET", `/search/issues${qs({ q: query, sort, order, per_page, page })}`);
        const hits = (data.items || []).map(i => ({
          number: i.number,
          title: i.title,
          state: i.state,
          is_pr: !!i.pull_request,
          user: i.user?.login,
          repository: (i.repository_url || "").replace("https://api.github.com/repos/", ""),
          html_url: i.html_url
        }));
        return ok(`${data.total_count} matches (page ${page}):\n\n` + JSON.stringify(hits, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  // ── Repository Secrets ────────────────────────────────────────────

  server.registerTool(
    "github_list_secrets",
    {
      title: "List repository secrets",
      description: "List secret names configured in a repository for GitHub Actions (secret values are never returned by GitHub).",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        per_page: z.number().int().min(1).max(100).default(30).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, per_page, page }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/actions/secrets${qs({ per_page, page })}`);
        const secrets = (data.secrets || []).map(s => ({
          name: s.name,
          created_at: s.created_at,
          updated_at: s.updated_at
        }));
        return ok(`Found ${data.total_count || secrets.length} secrets in ${owner}/${repo}:\n\n` + JSON.stringify(secrets, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_get_secret",
    {
      title: "Get repository secret metadata",
      description: "Get metadata (name, timestamps) for a specific GitHub Actions secret in a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        secret_name: z.string().describe("The name of the secret")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, secret_name }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/actions/secrets/${encodeURIComponent(secret_name)}`);
        return ok(`Secret '${data.name}' in ${owner}/${repo}:\nCreated: ${data.created_at}\nUpdated: ${data.updated_at}`, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_set_secret",
    {
      title: "Create or update repository secret",
      description: "Create or alter a repository secret for GitHub Actions. Automatically fetches the repository public key and encrypts the secret value with libsodium sealed box before transmission.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        secret_name: z.string().describe("Name of the secret (e.g. 'DEPLOY_TOKEN' or 'API_KEY')"),
        secret_value: z.string().describe("The plaintext secret value to encrypt and store")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, secret_name, secret_value }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        // 1. Fetch public key
        const keyInfo = await request("GET", `${base}/actions/secrets/public-key`);
        if (!keyInfo.key || !keyInfo.key_id) {
          throw new Error("Failed to retrieve public key for repository secrets encryption.");
        }

        // 2. Encrypt value using Libsodium crypto_box_seal
        const encrypted_value = sealSecret(secret_value, keyInfo.key);

        // 3. Put secret
        await request("PUT", `${base}/actions/secrets/${encodeURIComponent(secret_name)}`, {
          encrypted_value,
          key_id: keyInfo.key_id
        });

        return ok(`Successfully created/updated secret '${secret_name}' in ${owner}/${repo}.`, {
          name: secret_name,
          repository: `${owner}/${repo}`,
          key_id: keyInfo.key_id
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_delete_secret",
    {
      title: "Delete repository secret",
      description: "Delete an Action secret from a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        secret_name: z.string().describe("Name of the secret to delete")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, secret_name }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        await request("DELETE", `${base}/actions/secrets/${encodeURIComponent(secret_name)}`);
        return ok(`Deleted secret '${secret_name}' from ${owner}/${repo}.`, { name: secret_name, deleted: true });
      } catch (e) { return fail(e); }
    }
  );

  // ── Repository Variables (Actions Configuration) ─────────────────

  server.registerTool(
    "github_list_variables",
    {
      title: "List repository variables",
      description: "List all GitHub Actions variables and their plaintext values in a repository. Unlike secrets (which GitHub makes write-only), variable values are fully readable.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        per_page: z.number().int().min(1).max(100).default(30).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, per_page, page }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/actions/variables${qs({ per_page, page })}`);
        const vars = (data.variables || []).map(v => ({
          name: v.name,
          value: v.value,
          created_at: v.created_at,
          updated_at: v.updated_at
        }));
        return ok(`Found ${data.total_count || vars.length} variables in ${owner}/${repo}:\n\n` + JSON.stringify(vars, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_get_variable",
    {
      title: "Get repository variable",
      description: "Read a specific GitHub Actions variable value and metadata from a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        variable_name: z.string().describe("The name of the variable")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, variable_name }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/actions/variables/${encodeURIComponent(variable_name)}`);
        const summary = {
          name: data.name,
          value: data.value,
          created_at: data.created_at,
          updated_at: data.updated_at
        };
        return ok(`Variable '${data.name}' in ${owner}/${repo}:\n\n` + JSON.stringify(summary, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_set_variable",
    {
      title: "Create or update repository variable",
      description: "Create or update a GitHub Actions repository variable. Variable values are stored in plaintext and are readable via API.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        variable_name: z.string().describe("Name of the variable (e.g. 'ENVIRONMENT' or 'API_URL')"),
        variable_value: z.string().describe("The plaintext value of the variable")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, variable_name, variable_value }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        let created = false;
        try {
          await request("POST", `${base}/actions/variables`, {
            name: variable_name,
            value: variable_value
          });
          created = true;
        } catch (postErr) {
          // If already exists, update with PATCH
          await request("PATCH", `${base}/actions/variables/${encodeURIComponent(variable_name)}`, {
            value: variable_value
          });
        }
        return ok(`Successfully ${created ? "created" : "updated"} variable '${variable_name}' in ${owner}/${repo}.`, {
          name: variable_name,
          value: variable_value,
          repository: `${owner}/${repo}`
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_delete_variable",
    {
      title: "Delete repository variable",
      description: "Delete an Action configuration variable from a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        variable_name: z.string().describe("Name of the variable to delete")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, variable_name }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        await request("DELETE", `${base}/actions/variables/${encodeURIComponent(variable_name)}`);
        return ok(`Deleted variable '${variable_name}' from ${owner}/${repo}.`, { name: variable_name, deleted: true });
      } catch (e) { return fail(e); }
    }
  );

  // ── Releases & Tags ──────────────────────────────────────────────

  server.registerTool(
    "github_list_tags",
    {
      title: "List Git tags",
      description: "List git tags in a repository with commit SHAs and archive links.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        per_page: z.number().int().min(1).max(100).default(30).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, per_page, page }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/tags${qs({ per_page, page })}`);
        const tags = data.map(t => ({
          name: t.name,
          commit_sha: t.commit?.sha,
          tarball_url: t.tarball_url,
          zipball_url: t.zipball_url
        }));
        return ok(`Tags in ${owner}/${repo} (page ${page}):\n\n` + JSON.stringify(tags, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_list_releases",
    {
      title: "List releases",
      description: "List releases published in a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        per_page: z.number().int().min(1).max(100).default(20).describe("Results per page"),
        page: z.number().int().min(1).default(1).describe("Page number")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, per_page, page }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const data = await request("GET", `${base}/releases${qs({ per_page, page })}`);
        const releases = data.map(r => ({
          id: r.id,
          tag_name: r.tag_name,
          name: r.name,
          draft: r.draft,
          prerelease: r.prerelease,
          published_at: r.published_at,
          html_url: r.html_url
        }));
        return ok(`Releases in ${owner}/${repo} (page ${page}):\n\n` + JSON.stringify(releases, null, 2), data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_create_release",
    {
      title: "Create release",
      description: "Create or draft a release with a Git tag in a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        tag_name: z.string().describe("The name of the tag (e.g. 'v1.0.0')"),
        name: z.string().optional().describe("The title of the release"),
        body: z.string().optional().describe("Text describing the contents of the release (release notes)"),
        target_commitish: z.string().optional().describe("Specifies the commitish value that determines where the Git tag is created (e.g. 'main' or commit SHA). Default: default branch."),
        draft: z.boolean().default(false).describe("true to create a draft (unpublished) release"),
        prerelease: z.boolean().default(false).describe("true to identify the release as a prerelease"),
        generate_release_notes: z.boolean().default(false).describe("Whether to automatically generate the name and body for this release based on merged PRs")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, tag_name, name, body, target_commitish, draft, prerelease, generate_release_notes }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const payload = { tag_name, draft, prerelease, generate_release_notes };
        if (name) payload.name = name;
        if (body) payload.body = body;
        if (target_commitish) payload.target_commitish = target_commitish;
        const data = await request("POST", `${base}/releases`, payload);
        return ok(`Created release '${data.name || data.tag_name}' (${data.draft ? "draft" : "published"}) in ${owner}/${repo}\nURL: ${data.html_url}`, data);
      } catch (e) { return fail(e); }
    }
  );

  // ── Git Clone / Pull & Repository Structure ───────────────────────

  server.registerTool(
    "github_get_clone_info",
    {
      title: "Get Git clone and pull info",
      description: "Get credential-free HTTPS/SSH clone URLs, default branch, and pull instructions. Authenticate Git separately with a credential helper.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        const r = await request("GET", base);
        const { pat } = getClient();

        const info = {
          repository: `${owner}/${repo}`,
          default_branch: r.default_branch,
          clone_url_https: r.clone_url,
          clone_url_ssh: r.ssh_url,
          git_url: r.git_url,
          commands: {
            clone_https: `git clone ${r.clone_url}`,
            clone_ssh: `git clone ${r.ssh_url}`,
            clone_command: `git clone https://github.com/${owner}/${repo}.git`,
            pull_latest: `git pull origin ${r.default_branch}`,
            fetch_all: `git fetch --all --prune`
          }
        };

        const text =
          `Repository: ${owner}/${repo} (default branch: ${r.default_branch})\n\n` +
          `• HTTPS: ${r.clone_url}\n` +
          `• SSH:   ${r.ssh_url}\n\n` +
          `Git Commands:\n` +
          `  git clone ${r.clone_url}\n` +
          `  git clone https://github.com/${owner}/${repo}.git\n` +
          `  git pull origin ${r.default_branch}`;

        return ok(text, info);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_get_tree",
    {
      title: "Get full repository Git tree",
      description: "Recursively retrieve the complete file tree of a repository for a given branch or commit SHA (up to 100,000 entries). Like inspecting the entire file structure of a cloned repo in one step.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        tree_sha: z.string().optional().describe("Branch name (e.g. 'main') or commit/tree SHA. Default: default branch head."),
        recursive: z.boolean().default(true).describe("Whether to fetch all subdirectories recursively")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, tree_sha, recursive }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        let targetSha = tree_sha;
        if (!targetSha) {
          const r = await request("GET", base);
          targetSha = r.default_branch;
        }

        const query = recursive ? "?recursive=1" : "";
        const data = await request("GET", `${base}/git/trees/${encodePath(targetSha)}${query}`);

        const tree = (data.tree || []).map(item => ({
          path: item.path,
          mode: item.mode,
          type: item.type, // 'blob' or 'tree'
          size: item.size,
          sha: item.sha
        }));

        const summary = `Git tree for ${owner}/${repo} @ ${targetSha} (${tree.length} items${data.truncated ? ", TRUNCATED" : ""}):\n\n` +
          JSON.stringify(tree.slice(0, 300), null, 2) +
          (tree.length > 300 ? `\n\n... and ${tree.length - 300} more items.` : "");

        return ok(summary, data);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "github_get_archive_link",
    {
      title: "Get repository archive download link",
      description: "Get direct download URLs for an archive (zipball or tarball) of the repository at any ref/branch/tag.",
      inputSchema: {
        repository: z.string().describe("Repository name ('owner/repo' or just 'repo' if Default Owner is set)"),
        ref: z.string().optional().describe("Branch name, tag, or commit SHA. Default: default branch."),
        format: z.enum(["zipball", "tarball"]).default("zipball").describe("Archive format ('zipball' or 'tarball')")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ repository, ref, format }) => {
      try {
        const { owner, repo, base } = repoBase(repository);
        let targetRef = ref;
        if (!targetRef) {
          const r = await request("GET", base);
          targetRef = r.default_branch;
        }

        const archiveUrl = `https://api.github.com/repos/${owner}/${repo}/${format}/${encodeURIComponent(targetRef)}`;
        const browserDownloadUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${encodeURIComponent(targetRef)}.${format === "zipball" ? "zip" : "tar.gz"}`;

        const text =
          `Archive URLs for ${owner}/${repo} @ ${targetRef} (${format}):\n\n` +
          `• API download: ${archiveUrl}\n` +
          `• Direct Web download: ${browserDownloadUrl}\n\n` +
          `Note: To download via API with curl:\n` +
          `curl -L -H "Authorization: Bearer <PAT>" "${archiveUrl}" -o ${repo}-${targetRef}.${format === "zipball" ? "zip" : "tar.gz"}`;

        return ok(text, { repository: `${owner}/${repo}`, ref: targetRef, format, archiveUrl, browserDownloadUrl });
      } catch (e) { return fail(e); }
    }
  );
}

async function testService(settings, { fetchJson }) {
  const missing = configurationError("github", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  if (!settings.pat) return { ok: false, message: "PAT not set" };
  try {
    const data = await fetchJson("https://api.github.com/user", {
      headers: {
        "Authorization": `Bearer ${settings.pat}`,
        "User-Agent": "MCP-Station-GitHub-Module",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    return { ok: true, message: `Connected as ${data.login}` };
  } catch (e) {
    return { ok: false, message: `GitHub API connection failed: ${e.message}` };
  }
}
/** UI connectivity checks never expose provider bodies or account/session details. */
export async function test(settings, context = {}) {
  const missing = configurationError("github", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const result = await testService(settings, context);
    return result.ok ? { ok: true, message: "Connection successful." } :
      { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  } catch {
    return { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  }
}
