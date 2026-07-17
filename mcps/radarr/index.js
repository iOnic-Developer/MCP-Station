export function register({ server, z, getSettings, log, fetchJson }) {
  const MAX_OUTPUT = 24000;

  // Helper to make requests to the Radarr API (v3 path — Radarr v3, v4 and v5 all serve it)
  async function request(endpoint, method = 'GET', body = null) {
    const { radarr_url, api_key } = getSettings();
    if (!radarr_url || !api_key) {
      throw new Error('radarr_url or api_key is not configured. Open MCP Station → Radarr → Settings.');
    }
    const cleanUrl = radarr_url.replace(/\/+$/, '');
    const url = `${cleanUrl}/api/v3/${endpoint.replace(/^\//, '')}`;
    const options = {
      method,
      headers: {
        'X-Api-Key': api_key,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };
    if (body) options.body = JSON.stringify(body);
    try {
      return await fetchJson(url, options);
    } catch (e) {
      log(`radarr: ${method} ${endpoint} failed — ${e.message}`);
      throw new Error(`Radarr API error on ${method} ${endpoint}: ${e.message}`);
    }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function clip(md) {
    if (md.length <= MAX_OUTPUT) return md;
    return md.slice(0, MAX_OUTPUT) + '\n\n…(output truncated — narrow with filter/limit args)';
  }

  const STATUS_EMOJI = { tba: '❔', announced: '🔜', inCinemas: '🎞️', released: '🟢', deleted: '🗑️' };
  const movieTag = (m) => `${STATUS_EMOJI[m.status] || '❔'} ${m.status || 'unknown'} | ${m.monitored ? '👁️ Monitored' : '🚫 Not monitored'} | ${m.hasFile ? `💾 ${formatBytes(m.sizeOnDisk)}` : '❌ No file'}`;

  // 1. List movies
  server.registerTool(
    'radarr_list_movies',
    {
      title: 'List Movies',
      description: `List movies in the Radarr library with status, monitoring and file state.

Args:
  - filter (optional): case-insensitive substring match on the title.
  - missing (optional): only monitored movies with no file yet.
  - limit (1-500, default 100) / offset (default 0): pagination over the (filtered) library.
Returns: markdown list with internal ID, TMDB ID, status, monitored flag, file size, path. The internal \`id\`s feed radarr_get_movie, radarr_delete_movie and radarr_trigger_command.
Errors: "radarr_url or api_key is not configured…" — set them in Settings.`,
      inputSchema: {
        filter: z.string().optional().describe('Only titles containing this text (case-insensitive)'),
        missing: z.boolean().default(false).describe('Only monitored movies that have no file yet'),
        limit: z.number().int().min(1).max(500).default(100).describe('Max movies to return'),
        offset: z.number().int().min(0).default(0).describe('Skip this many (for paging)')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ filter, missing, limit, offset }) => {
      try {
        let movies = await request('/movie');
        if (!Array.isArray(movies) || movies.length === 0) {
          return { content: [{ type: 'text', text: 'No movies in Radarr. Use radarr_lookup_movie then radarr_add_movie to add one.' }] };
        }
        const total = movies.length;
        if (filter) {
          const f = filter.toLowerCase();
          movies = movies.filter(m => (m.title || '').toLowerCase().includes(f));
        }
        if (missing) movies = movies.filter(m => m.monitored && !m.hasFile);
        const shown = movies.slice(offset, offset + limit);
        const lines = shown.map(m =>
          `- **${m.title}** (${m.year}) (ID: \`${m.id}\` | TMDB: \`${m.tmdbId}\`) — ${movieTag(m)}\n  *Path*: \`${m.path}\``
        );
        const header = `### Radarr Movies (showing ${shown.length} of ${movies.length}${filter ? ` matching "${filter}"` : ''}${missing ? ', missing only' : ''}; library total ${total})`;
        return {
          content: [{ type: 'text', text: clip(`${header}\n\n${lines.join('\n')}`) }],
          structuredContent: { total, matched: movies.length, offset, shown: shown.length, movies: shown }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error listing movies: ${e.message}` }] };
      }
    }
  );

  // 2. Lookup / search for a movie (TMDB via Radarr)
  server.registerTool(
    'radarr_lookup_movie',
    {
      title: 'Lookup Movie',
      description: `Search for movies by name, or exactly by 'tmdb:<id>' / 'imdb:<ttid>', via Radarr's TMDB-backed lookup. Use this FIRST to get the tmdbId needed by radarr_add_movie; results show whether a movie is already in the library.`,
      inputSchema: {
        term: z.string().min(1).describe(`Search term, e.g. 'Dune Part Two', 'tmdb:693134' or 'imdb:tt15239678'`)
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ term }) => {
      try {
        let results;
        const tmdb = term.match(/^tmdb:\s*(\d+)$/i);
        const imdb = term.match(/^imdb:\s*(tt\d+)$/i);
        if (tmdb) {
          results = [await request(`/movie/lookup/tmdb?tmdbId=${tmdb[1]}`)];
        } else if (imdb) {
          results = [await request(`/movie/lookup/imdb?imdbId=${imdb[1]}`)];
        } else {
          results = await request(`/movie/lookup?term=${encodeURIComponent(term)}`);
        }
        results = (results || []).filter(Boolean);
        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No matches for "${term}". Try a different spelling, or a tmdb:<id> / imdb:<ttid> term.` }] };
        }
        const top = results.slice(0, 10);
        const lines = top.map(m => {
          const studio = m.studio ? `— ${m.studio}` : '';
          const added = m.id ? `✅ Already in library (ID: \`${m.id}\`)` : `➕ Not added yet — use tmdbId \`${m.tmdbId}\``;
          const overview = (m.overview || 'No overview available').slice(0, 300);
          return `- **${m.title}** (${m.year}) ${studio}\n  *TMDB*: \`${m.tmdbId}\`${m.imdbId ? ` | *IMDb*: \`${m.imdbId}\`` : ''} | *Status*: ${m.status}${m.runtime ? ` | ${m.runtime} min` : ''}\n  ${added}\n  *Overview*: ${overview}\n`;
        });
        const more = results.length > 10 ? `\n_(showing first 10 of ${results.length} results)_` : '';
        return {
          content: [{ type: 'text', text: clip(`### Lookup results for "${term}"\n\n${lines.join('\n')}${more}`) }],
          structuredContent: { count: results.length, results: top }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error looking up movie: ${e.message}` }] };
      }
    }
  );

  // 3. Add a movie
  server.registerTool(
    'radarr_add_movie',
    {
      title: 'Add Movie',
      description: `Add a movie to Radarr. Quality profile and root folder default to the first ones configured in Radarr when omitted.

Args:
  - tmdbId (required): from radarr_lookup_movie.
  - minimumAvailability: when Radarr may start grabbing — announced | inCinemas | released (default released, which waits for a proper web/physical release and avoids cam junk).
  - monitor: movieOnly | movieAndCollection | none (default movieOnly).
  - searchNow: search indexers for the movie immediately (default true).
Returns: confirmation with the new internal ID and path, or a notice if the movie is already in the library.`,
      inputSchema: {
        tmdbId: z.number().int().describe('TMDB ID of the movie (find it with radarr_lookup_movie)'),
        title: z.string().optional().describe('Optional title override (metadata title is used by default)'),
        qualityProfileId: z.number().int().optional().describe('Quality profile ID (see radarr_get_profiles_and_paths); defaults to the first profile'),
        rootFolderPath: z.string().optional().describe('Root folder for the movie; defaults to the first configured root folder'),
        minimumAvailability: z.enum(['announced', 'inCinemas', 'released']).default('released').describe('When the movie counts as available to grab'),
        monitor: z.enum(['movieOnly', 'movieAndCollection', 'none']).default('movieOnly').describe('What to monitor — movieAndCollection also monitors the rest of its collection'),
        monitored: z.boolean().default(true).describe('Monitor the movie'),
        searchNow: z.boolean().default(true).describe('Search indexers for the movie immediately after adding')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ tmdbId, title, qualityProfileId, rootFolderPath, minimumAvailability, monitor, monitored, searchNow }) => {
      try {
        // Step 1: TMDB lookup gives Radarr's full movie template (images, titleSlug…)
        const template = await request(`/movie/lookup/tmdb?tmdbId=${tmdbId}`);
        if (!template || !template.tmdbId) {
          return { content: [{ type: 'text', text: `Error: no metadata found for TMDB ID ${tmdbId}. Verify it with radarr_lookup_movie.` }] };
        }

        // Already in the library? Don't POST a duplicate — Radarr would 400.
        if (template.id) {
          return {
            content: [{ type: 'text', text: `ℹ️ **${template.title}** (${template.year}) is already in the library (ID: \`${template.id}\`, path \`${template.path}\`). Use radarr_trigger_command (MoviesSearch) or radarr_get_movie with that ID instead.` }],
            structuredContent: { alreadyAdded: true, movie: template }
          };
        }

        // Step 2: fill in profile / root folder defaults when omitted
        if (qualityProfileId) {
          template.qualityProfileId = qualityProfileId;
        } else {
          const profiles = await request('/qualityprofile');
          if (!Array.isArray(profiles) || profiles.length === 0) {
            return { content: [{ type: 'text', text: 'Error: no quality profiles configured in Radarr — create one in Radarr → Settings → Profiles first.' }] };
          }
          template.qualityProfileId = profiles[0].id;
        }
        if (rootFolderPath) {
          template.rootFolderPath = rootFolderPath;
        } else {
          const roots = await request('/rootfolder');
          if (!Array.isArray(roots) || roots.length === 0) {
            return { content: [{ type: 'text', text: 'Error: no root folders configured in Radarr — add one in Radarr → Settings → Media Management first.' }] };
          }
          template.rootFolderPath = roots[0].path;
        }

        if (title) template.title = title;
        template.monitored = monitored;
        template.minimumAvailability = minimumAvailability;
        template.addOptions = {
          monitor,
          searchForMovie: searchNow
        };

        const result = await request('/movie', 'POST', template);
        const markdown = `🎉 **Movie added!**

- **Title**: ${result.title} (${result.year})
- **Internal ID**: \`${result.id}\`
- **TMDB ID**: \`${result.tmdbId}\`
- **Path**: \`${result.path}\`
- **Quality profile**: \`${result.qualityProfileId}\`
- **Minimum availability**: \`${result.minimumAvailability}\` | **Monitor**: \`${monitor}\`
- **Searching now**: ${searchNow ? 'Yes' : 'No'}`;
        return { content: [{ type: 'text', text: markdown }], structuredContent: result };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error adding movie: ${e.message}` }] };
      }
    }
  );

  // 4. Movie details
  server.registerTool(
    'radarr_get_movie',
    {
      title: 'Get Movie',
      description: `Full details for one movie — availability, release dates, file (quality, size), overview. Use radarr_list_movies to find the internal id.`,
      inputSchema: {
        movieId: z.number().int().describe('Internal Radarr movie ID (from radarr_list_movies)')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ movieId }) => {
      try {
        const m = await request(`/movie/${movieId}`);
        const d = (x) => x ? String(x).slice(0, 10) : '—';
        let md = `### ${m.title} (${m.year})\n\n`;
        md += `> ${movieTag(m)} | available now: ${m.isAvailable ? 'yes' : 'no'} (minimum: \`${m.minimumAvailability}\`)\n\n`;
        md += `| Field | Value |\n|---|---|\n`;
        md += `| Internal ID | \`${m.id}\` |\n| TMDB / IMDb | \`${m.tmdbId}\`${m.imdbId ? ` / \`${m.imdbId}\`` : ''} |\n`;
        md += `| Studio | ${m.studio || '—'} |\n| Runtime | ${m.runtime ? m.runtime + ' min' : '—'} |\n`;
        md += `| Certification | ${m.certification || '—'} |\n| Genres | ${(m.genres || []).join(', ') || '—'} |\n`;
        md += `| In cinemas | ${d(m.inCinemas)} |\n| Digital release | ${d(m.digitalRelease)} |\n| Physical release | ${d(m.physicalRelease)} |\n`;
        md += `| Path | \`${m.path}\` |\n| Quality profile | \`${m.qualityProfileId}\` |\n`;
        if (m.movieFile) {
          md += `| File | \`${m.movieFile.relativePath}\` — ${m.movieFile.quality?.quality?.name || '?'}, ${formatBytes(m.movieFile.size)} |\n`;
        }
        if (m.overview) md += `\n${m.overview.slice(0, 600)}\n`;
        return { content: [{ type: 'text', text: clip(md) }], structuredContent: m };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error getting movie ${movieId}: ${e.message}. Check the ID with radarr_list_movies.` }] };
      }
    }
  );

  // 5. Delete a movie
  server.registerTool(
    'radarr_delete_movie',
    {
      title: 'Delete Movie',
      description: `Delete a movie from Radarr. The file stays on disk unless deleteFiles=true (matches the Radarr API default). Optionally add an import exclusion so lists can't re-add it. (Note: Radarr's param is addImportExclusion — not Sonarr's addImportListExclusion.)`,
      inputSchema: {
        id: z.number().int().describe('Internal Radarr ID of the movie (from radarr_list_movies)'),
        deleteFiles: z.boolean().default(false).describe('DANGER: also delete the movie file from disk'),
        addImportExclusion: z.boolean().default(false).describe('Block import lists from re-adding this movie')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ id, deleteFiles, addImportExclusion }) => {
      try {
        await request(`/movie/${id}?deleteFiles=${deleteFiles}&addImportExclusion=${addImportExclusion}`, 'DELETE');
        return {
          content: [{
            type: 'text',
            text: `🗑️ **Movie ID ${id} deleted.**\n- File removed from disk: **${deleteFiles ? 'YES' : 'no'}**\n- Import exclusion added: **${addImportExclusion ? 'yes' : 'no'}**`
          }]
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error deleting movie ${id}: ${e.message}. Check the ID with radarr_list_movies.` }] };
      }
    }
  );

  // 6. Download queue
  server.registerTool(
    'radarr_get_queue',
    {
      title: 'Get Queue',
      description: `Current download queue with per-item progress, ETA, download client, and any warnings/errors (stalled, import blocked, …).`,
      inputSchema: {
        pageSize: z.number().int().min(1).max(200).default(50).describe('Max queue items to return')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ pageSize }) => {
      try {
        const queue = await request(`/queue?page=1&pageSize=${pageSize}&includeUnknownMovieItems=true&includeMovie=true`);
        const records = queue.records || [];
        if (records.length === 0) {
          return { content: [{ type: 'text', text: '📭 The download queue is empty.' }] };
        }
        const lines = records.map(q => {
          const size = Number(q.size) || 0;
          const left = Number(q.sizeleft) || 0;
          const pct = size > 0 ? ((1 - left / size) * 100).toFixed(1) : '0.0';
          const eta = q.timeleft ? ` (ETA: ${q.timeleft})` : '';
          const what = q.movie?.title ? `${q.movie.title} (${q.movie.year})` : (q.title || 'Unknown item');
          const state = q.trackedDownloadState && q.trackedDownloadState !== 'downloading' ? ` → ${q.trackedDownloadState}` : '';
          const status = q.status === 'downloading' ? '⚡ downloading' : `⏳ ${q.status || 'unknown'}`;
          const warn = q.trackedDownloadStatus && q.trackedDownloadStatus !== 'ok' ? ` ⚠️ ${q.trackedDownloadStatus}` : '';
          const msgs = (q.statusMessages || [])
            .flatMap(m => m.messages && m.messages.length ? m.messages : [m.title])
            .filter(Boolean).slice(0, 3);
          const err = q.errorMessage ? `\n  ❗ ${q.errorMessage}` : (msgs.length ? `\n  ⚠️ ${msgs.join(' · ')}` : '');
          return `- **${what}**\n  *Release*: ${q.title || '—'}\n  *Status*: ${status}${state}${warn} | *Progress*: ${pct}% (${formatBytes(left)} left of ${formatBytes(size)})${eta}\n  *Client*: \`${q.downloadClient || '?'}\` | *Protocol*: \`${q.protocol || '?'}\` | *Indexer*: \`${q.indexer || '?'}\`${err}`;
        });
        const header = `### Radarr queue — ${queue.totalRecords ?? records.length} item(s)${(queue.totalRecords ?? 0) > records.length ? ` (showing ${records.length})` : ''}`;
        return {
          content: [{ type: 'text', text: clip(`${header}\n\n${lines.join('\n')}`) }],
          structuredContent: queue
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error fetching queue: ${e.message}` }] };
      }
    }
  );

  // 7. Disk space
  server.registerTool(
    'radarr_get_diskspace',
    {
      title: 'Get Disk Space',
      description: 'Free/total disk space for every storage path Radarr can see. Use before adding movies or when downloads stall.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        const spaces = await request('/diskspace');
        if (!Array.isArray(spaces) || spaces.length === 0) {
          return { content: [{ type: 'text', text: 'No disk space info returned by Radarr.' }] };
        }
        const lines = spaces.map(d => {
          const pct = d.totalSpace > 0 ? ((d.freeSpace / d.totalSpace) * 100).toFixed(1) : '0.0';
          const flag = d.totalSpace > 0 && d.freeSpace / d.totalSpace < 0.1 ? ' ⚠️ low' : '';
          return `- \`${d.path}\` — free **${formatBytes(d.freeSpace)}** of **${formatBytes(d.totalSpace)}** (${pct}% free)${flag}`;
        });
        return {
          content: [{ type: 'text', text: `### Disk space\n\n${lines.join('\n')}` }],
          structuredContent: { disks: spaces }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error checking disk space: ${e.message}` }] };
      }
    }
  );

  // 8. Trigger a command
  server.registerTool(
    'radarr_trigger_command',
    {
      title: 'Trigger Command',
      description: `Run a Radarr command. Common ones:
  - MoviesSearch (movieIds) — search indexers for specific movies
  - MissingMoviesSearch — search everything missing & available
  - CutOffUnmetMoviesSearch — search for quality upgrades
  - RefreshMovie (movieIds optional) — refresh metadata + rescan
  - RescanMovie (movieId optional) — rescan disk files
  - RenameFiles (movieId + files) — rename movie files
  - RssSync — fetch indexer RSS now`,
      inputSchema: {
        name: z.string().describe(`Command name, e.g. 'MoviesSearch', 'MissingMoviesSearch', 'CutOffUnmetMoviesSearch', 'RefreshMovie', 'RescanMovie', 'RenameFiles', 'RssSync'`),
        movieIds: z.array(z.number().int()).optional().describe('Movie internal IDs (MoviesSearch, RefreshMovie)'),
        movieId: z.number().int().optional().describe('Single movie internal ID (RescanMovie, RenameFiles)'),
        files: z.array(z.number().int()).optional().describe('Movie file IDs (RenameFiles)')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, movieIds, movieId, files }) => {
      try {
        const payload = { name };
        if (movieIds?.length) payload.movieIds = movieIds;
        if (movieId !== undefined) payload.movieId = movieId;
        if (files?.length) payload.files = files;
        const result = await request('/command', 'POST', payload);
        const markdown = `📤 **Command triggered**\n\n- **Command**: \`${result.name}\`\n- **Status**: \`${result.status}\`\n- **ID**: \`${result.id}\`\n- **Queued**: \`${result.queued || result.startedOn || 'just now'}\``;
        return { content: [{ type: 'text', text: markdown }], structuredContent: result };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error triggering '${name}': ${e.message}` }] };
      }
    }
  );

  // 9. Profiles & root folders
  server.registerTool(
    'radarr_get_profiles_and_paths',
    {
      title: 'Get Profiles & Paths',
      description: 'List quality profiles and root folders — the valid values for radarr_add_movie.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        const profiles = await request('/qualityprofile');
        const roots = await request('/rootfolder');
        let md = '### 📋 Radarr configuration\n\n#### Quality profiles\n';
        md += (profiles || []).map(p => `- **${p.name}** (ID: \`${p.id}\`)`).join('\n') || '- none configured';
        md += '\n\n#### Root folders\n';
        md += (roots || []).map(r => `- \`${r.path}\` (free: ${formatBytes(r.freeSpace)})`).join('\n') || '- none configured';
        return {
          content: [{ type: 'text', text: md }],
          structuredContent: { qualityProfiles: profiles, rootFolders: roots }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error fetching configuration: ${e.message}` }] };
      }
    }
  );
}

// Powers the ▶ Test button
export async function test(settings, { fetchJson }) {
  if (!settings.radarr_url || !settings.api_key) {
    return { ok: false, message: 'radarr_url or api_key is missing — set both in Settings.' };
  }
  const cleanUrl = settings.radarr_url.replace(/\/+$/, '');
  try {
    const data = await fetchJson(`${cleanUrl}/api/v3/system/status`, {
      headers: { 'X-Api-Key': settings.api_key, 'Accept': 'application/json' }
    });
    return { ok: true, message: `Connected to Radarr v${data.version} (${data.instanceName || 'Default'})` };
  } catch (e) {
    return { ok: false, message: `Connection failed: ${e.message}` };
  }
}
