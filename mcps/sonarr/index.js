export function register({ server, z, getSettings, log, fetchJson }) {
  const MAX_OUTPUT = 24000;

  // Helper to make requests to the Sonarr API (v3 path — used by both Sonarr v3 and v4)
  async function request(endpoint, method = 'GET', body = null) {
    const { sonarr_url, api_key } = getSettings();
    if (!sonarr_url || !api_key) {
      throw new Error('sonarr_url or api_key is not configured. Open MCP Station → Sonarr → Settings.');
    }
    const cleanUrl = sonarr_url.replace(/\/+$/, '');
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
      log(`sonarr: ${method} ${endpoint} failed — ${e.message}`);
      throw new Error(`Sonarr API error on ${method} ${endpoint}: ${e.message}`);
    }
  }

  // Helper to format bytes to human-readable size
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Truncate long markdown output (house rule: ~25k chars max)
  function clip(md) {
    if (md.length <= MAX_OUTPUT) return md;
    return md.slice(0, MAX_OUTPUT) + '\n\n…(output truncated — narrow with filter/limit/seasonNumber args)';
  }

  const pad2 = (n) => String(n ?? 0).padStart(2, '0');

  const STATUS_EMOJI = { continuing: '🟢', upcoming: '🔜', ended: '🔴', deleted: '🗑️' };

  // 1. List all series
  server.registerTool(
    'sonarr_list_series',
    {
      title: 'List Series',
      description: `List series in the Sonarr library with status, monitoring and episode-file counts.

Args:
  - filter (optional): case-insensitive substring match on the title.
  - limit (1-500, default 100) / offset (default 0): pagination over the (filtered) library.
Returns: markdown list with internal ID, TVDB ID, status, monitored flag, episode counts, size on disk, path.
Errors: "sonarr_url or api_key is not configured…" — set them in Settings.`,
      inputSchema: {
        filter: z.string().optional().describe('Only titles containing this text (case-insensitive)'),
        limit: z.number().int().min(1).max(500).default(100).describe('Max series to return'),
        offset: z.number().int().min(0).default(0).describe('Skip this many (for paging)')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ filter, limit, offset }) => {
      try {
        let series = await request('/series');
        if (!Array.isArray(series) || series.length === 0) {
          return { content: [{ type: 'text', text: 'No series found in Sonarr. Use sonarr_lookup_series then sonarr_add_series to add one.' }] };
        }
        const total = series.length;
        if (filter) {
          const f = filter.toLowerCase();
          series = series.filter(s => (s.title || '').toLowerCase().includes(f));
        }
        const shown = series.slice(offset, offset + limit);
        const lines = shown.map(s => {
          const st = s.statistics || {};
          const stats = `(${st.episodeFileCount ?? 0}/${st.episodeCount ?? 0} eps, ${formatBytes(st.sizeOnDisk)})`;
          const status = `${STATUS_EMOJI[s.status] || '❔'} ${s.status || 'unknown'}`;
          const monitored = s.monitored ? '👁️ Monitored' : '🚫 Not monitored';
          return `- **${s.title}** (ID: \`${s.id}\` | TVDB: \`${s.tvdbId}\`) — ${status} | ${monitored} ${stats}\n  *Path*: \`${s.path}\``;
        });
        const header = `### Sonarr Series (showing ${shown.length} of ${series.length}${filter ? ` matching "${filter}"` : ''}; library total ${total})`;
        return {
          content: [{ type: 'text', text: clip(`${header}\n\n${lines.join('\n')}`) }],
          structuredContent: { total, matched: series.length, offset, shown: shown.length, series: shown }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error listing series: ${e.message}` }] };
      }
    }
  );

  // 2. Lookup / search for a series (TVDB via Sonarr)
  server.registerTool(
    'sonarr_lookup_series',
    {
      title: 'Lookup Series',
      description: `Search for shows by name (or "tvdb:<id>") via Sonarr's TVDB-backed lookup. Use this FIRST to get the tvdbId needed by sonarr_add_series; results also show whether a show is already in the library.`,
      inputSchema: {
        term: z.string().min(1).describe(`Search term, e.g. 'Breaking Bad' or 'tvdb:81189'`)
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ term }) => {
      try {
        const results = await request(`/series/lookup?term=${encodeURIComponent(term)}`);
        if (!Array.isArray(results) || results.length === 0) {
          return { content: [{ type: 'text', text: `No matches found for "${term}". Try a different spelling or a tvdb:<id> term.` }] };
        }
        const top = results.slice(0, 10);
        const lines = top.map(s => {
          const year = s.year ? `(${s.year})` : '';
          const network = s.network ? `on ${s.network}` : '';
          const seasons = s.statistics?.seasonCount ?? s.seasons?.length ?? 0;
          const added = s.id ? `✅ Already in library (ID: \`${s.id}\`)` : `➕ Not added yet — use tvdbId \`${s.tvdbId}\``;
          const overview = (s.overview || 'No overview available').slice(0, 300);
          return `- **${s.title}** ${year} ${network}\n  *TVDB*: \`${s.tvdbId}\` | *Status*: ${s.status} | *Seasons*: ${seasons}\n  ${added}\n  *Overview*: ${overview}\n`;
        });
        const more = results.length > 10 ? `\n_(showing first 10 of ${results.length} results)_` : '';
        return {
          content: [{ type: 'text', text: clip(`### Lookup results for "${term}"\n\n${lines.join('\n')}${more}`) }],
          structuredContent: { count: results.length, results: top }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error looking up series: ${e.message}` }] };
      }
    }
  );

  // 3. Add a series
  server.registerTool(
    'sonarr_add_series',
    {
      title: 'Add Series',
      description: `Add a new series to Sonarr. Quality profile and root folder default to the first ones configured in Sonarr when omitted.

Args:
  - tvdbId (required): from sonarr_lookup_series.
  - monitor: which episodes to monitor — all | future | missing | existing | firstSeason | lastSeason | pilot | recent | none (default all). 'pilot' monitors + grabs just the first episode — the try-a-show-before-committing pattern.
  - searchMissing: start an indexer search for monitored missing episodes right after adding (default true).
  - searchCutoffUnmet: also search for upgrades of episodes below quality cutoff (default false).
Returns: confirmation with the new internal ID and path, or a notice if the show is already in the library.`,
      inputSchema: {
        tvdbId: z.number().int().describe('TVDB ID of the series (find it with sonarr_lookup_series)'),
        title: z.string().optional().describe('Optional title override (metadata title is used by default)'),
        qualityProfileId: z.number().int().optional().describe('Quality profile ID (see sonarr_get_profiles_and_paths); defaults to the first profile'),
        rootFolderPath: z.string().optional().describe('Root folder for the series; defaults to the first configured root folder'),
        monitor: z.enum(['all', 'future', 'missing', 'existing', 'firstSeason', 'lastSeason', 'pilot', 'recent', 'none'])
          .default('all').describe('Which episodes to monitor'),
        monitored: z.boolean().default(true).describe('Monitor the series itself'),
        seasonFolder: z.boolean().default(true).describe('Create a subfolder per season'),
        searchMissing: z.boolean().default(true).describe('Search indexers for missing episodes immediately'),
        searchCutoffUnmet: z.boolean().default(false).describe('Also search for cutoff-unmet upgrades'),
        languageProfileId: z.number().int().optional().describe('LEGACY (Sonarr v3 only) — ignored by Sonarr v4, which removed language profiles')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ tvdbId, title, qualityProfileId, rootFolderPath, monitor, monitored, seasonFolder, searchMissing, searchCutoffUnmet, languageProfileId }) => {
      try {
        // Step 1: lookup gives us Sonarr's full series template (images, seasons, titleSlug…)
        const lookup = await request(`/series/lookup?term=tvdb:${tvdbId}`);
        if (!Array.isArray(lookup) || lookup.length === 0) {
          return { content: [{ type: 'text', text: `Error: no metadata found for TVDB ID ${tvdbId}. Verify it with sonarr_lookup_series.` }] };
        }
        const template = lookup[0];

        // Already in the library? Don't POST a duplicate — Sonarr would 400.
        if (template.id) {
          return {
            content: [{ type: 'text', text: `ℹ️ **${template.title}** is already in the library (ID: \`${template.id}\`, path \`${template.path}\`). Use sonarr_trigger_command (SeriesSearch/RefreshSeries) or sonarr_get_episodes with that ID instead.` }],
            structuredContent: { alreadyAdded: true, series: template }
          };
        }

        // Step 2: fill in profile / root folder defaults when omitted
        if (qualityProfileId) {
          template.qualityProfileId = qualityProfileId;
        } else {
          const profiles = await request('/qualityprofile');
          if (!Array.isArray(profiles) || profiles.length === 0) {
            return { content: [{ type: 'text', text: 'Error: no quality profiles configured in Sonarr — create one in Sonarr → Settings → Profiles first.' }] };
          }
          template.qualityProfileId = profiles[0].id;
        }
        if (rootFolderPath) {
          template.rootFolderPath = rootFolderPath;
        } else {
          const roots = await request('/rootfolder');
          if (!Array.isArray(roots) || roots.length === 0) {
            return { content: [{ type: 'text', text: 'Error: no root folders configured in Sonarr — add one in Sonarr → Settings → Media Management first.' }] };
          }
          template.rootFolderPath = roots[0].path;
        }
        // Sonarr v3 legacy only — v4 deprecated language profiles (its endpoint returns a stub), so never auto-detect.
        if (languageProfileId) template.languageProfileId = languageProfileId;

        if (title) template.title = title;
        template.monitored = monitored;
        template.seasonFolder = seasonFolder;
        if (!template.monitorNewItems) template.monitorNewItems = 'all';
        template.addOptions = {
          monitor,
          searchForMissingEpisodes: searchMissing,
          searchForCutoffUnmetEpisodes: searchCutoffUnmet
        };

        const result = await request('/series', 'POST', template);
        const markdown = `🎉 **Series added!**

- **Title**: ${result.title}
- **Internal ID**: \`${result.id}\`
- **TVDB ID**: \`${result.tvdbId}\`
- **Path**: \`${result.path}\`
- **Quality profile**: \`${result.qualityProfileId}\`
- **Monitor**: \`${monitor}\` | **Season folders**: ${result.seasonFolder ? 'Yes' : 'No'}
- **Searching missing now**: ${searchMissing ? 'Yes' : 'No'}`;
        return { content: [{ type: 'text', text: markdown }], structuredContent: result };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error adding series: ${e.message}` }] };
      }
    }
  );

  // 4. Delete a series
  server.registerTool(
    'sonarr_delete_series',
    {
      title: 'Delete Series',
      description: `Delete a series from Sonarr. Files stay on disk unless deleteFiles=true (matches the Sonarr API default). Optionally add an import-list exclusion so lists can't re-add the show.`,
      inputSchema: {
        id: z.number().int().describe('Internal Sonarr ID of the series (from sonarr_list_series)'),
        deleteFiles: z.boolean().default(false).describe('DANGER: also delete all episode files from disk'),
        addImportListExclusion: z.boolean().default(false).describe('Block import lists from re-adding this show')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ id, deleteFiles, addImportListExclusion }) => {
      try {
        await request(`/series/${id}?deleteFiles=${deleteFiles}&addImportListExclusion=${addImportListExclusion}`, 'DELETE');
        return {
          content: [{
            type: 'text',
            text: `🗑️ **Series ID ${id} deleted.**\n- Files removed from disk: **${deleteFiles ? 'YES' : 'no'}**\n- Import-list exclusion added: **${addImportListExclusion ? 'yes' : 'no'}**`
          }]
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error deleting series ${id}: ${e.message}. Check the ID with sonarr_list_series.` }] };
      }
    }
  );

  // 5. Download queue
  server.registerTool(
    'sonarr_get_queue',
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
        const queue = await request(`/queue?page=1&pageSize=${pageSize}&includeUnknownSeriesItems=true&includeSeries=true&includeEpisode=true`);
        const records = queue.records || [];
        if (records.length === 0) {
          return { content: [{ type: 'text', text: '📭 The download queue is empty.' }] };
        }
        const lines = records.map(q => {
          const size = Number(q.size) || 0;
          const left = Number(q.sizeleft) || 0;
          const pct = size > 0 ? ((1 - left / size) * 100).toFixed(1) : '0.0';
          const eta = q.timeleft ? ` (ETA: ${q.timeleft})` : '';
          const epTag = q.episode ? ` S${pad2(q.episode.seasonNumber)}E${pad2(q.episode.episodeNumber)}` : '';
          const what = q.series?.title ? `${q.series.title}${epTag}` : (q.title || 'Unknown item');
          const state = q.trackedDownloadState && q.trackedDownloadState !== 'downloading' ? ` → ${q.trackedDownloadState}` : '';
          const status = q.status === 'downloading' ? '⚡ downloading' : `⏳ ${q.status || 'unknown'}`;
          const warn = q.trackedDownloadStatus && q.trackedDownloadStatus !== 'ok' ? ` ⚠️ ${q.trackedDownloadStatus}` : '';
          const msgs = (q.statusMessages || [])
            .flatMap(m => m.messages && m.messages.length ? m.messages : [m.title])
            .filter(Boolean).slice(0, 3);
          const err = q.errorMessage ? `\n  ❗ ${q.errorMessage}` : (msgs.length ? `\n  ⚠️ ${msgs.join(' · ')}` : '');
          return `- **${what}**\n  *Release*: ${q.title || '—'}\n  *Status*: ${status}${state}${warn} | *Progress*: ${pct}% (${formatBytes(left)} left of ${formatBytes(size)})${eta}\n  *Client*: \`${q.downloadClient || '?'}\` | *Protocol*: \`${q.protocol || '?'}\` | *Indexer*: \`${q.indexer || '?'}\`${err}`;
        });
        const header = `### Sonarr queue — ${queue.totalRecords ?? records.length} item(s)${(queue.totalRecords ?? 0) > records.length ? ` (showing ${records.length})` : ''}`;
        return {
          content: [{ type: 'text', text: clip(`${header}\n\n${lines.join('\n')}`) }],
          structuredContent: queue
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error fetching queue: ${e.message}` }] };
      }
    }
  );

  // 6. Disk space
  server.registerTool(
    'sonarr_get_diskspace',
    {
      title: 'Get Disk Space',
      description: 'Free/total disk space for every storage path Sonarr can see. Use before adding shows or when downloads stall.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        const spaces = await request('/diskspace');
        if (!Array.isArray(spaces) || spaces.length === 0) {
          return { content: [{ type: 'text', text: 'No disk space info returned by Sonarr.' }] };
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

  // 7. Episodes of a series
  server.registerTool(
    'sonarr_get_episodes',
    {
      title: 'Get Episodes',
      description: `List a series' episodes grouped by season — internal id, downloaded/missing, monitored, air date. The episode \`id\`s are what sonarr_trigger_command's EpisodeSearch expects. Filter to one season with seasonNumber for long shows.`,
      inputSchema: {
        seriesId: z.number().int().describe('Internal Sonarr series ID (from sonarr_list_series)'),
        seasonNumber: z.number().int().min(0).optional().describe('Only this season (0 = specials)')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ seriesId, seasonNumber }) => {
      try {
        let eps = await request(`/episode?seriesId=${seriesId}`);
        if (!Array.isArray(eps) || eps.length === 0) {
          return { content: [{ type: 'text', text: `No episodes found for series ID ${seriesId}. Check the ID with sonarr_list_series.` }] };
        }
        if (seasonNumber !== undefined) eps = eps.filter(e => e.seasonNumber === seasonNumber);
        if (eps.length === 0) {
          return { content: [{ type: 'text', text: `Series ${seriesId} has no season ${seasonNumber}.` }] };
        }
        const seasons = {};
        for (const e of eps) (seasons[e.seasonNumber] ??= []).push(e);

        const have = eps.filter(e => e.hasFile).length;
        let markdown = `### Episodes — series ID ${seriesId}${seasonNumber !== undefined ? `, season ${seasonNumber}` : ''} (${have}/${eps.length} downloaded)\n\n_Episode ids feed \`sonarr_trigger_command\` → EpisodeSearch._\n\n`;
        for (const sNum of Object.keys(seasons).sort((a, b) => Number(a) - Number(b))) {
          markdown += `#### Season ${sNum}\n`;
          const rows = seasons[sNum]
            .sort((a, b) => a.episodeNumber - b.episodeNumber)
            .map(e => {
              const file = e.hasFile ? '💾' : '❌';
              const mon = e.monitored ? '👁️' : '🚫';
              return `* **E${pad2(e.episodeNumber)}** (id: \`${e.id}\`) — *"${e.title || 'TBA'}"* [${file} ${mon}] (air: ${e.airDate || 'TBA'})`;
            });
          markdown += rows.join('\n') + '\n\n';
        }
        return {
          content: [{ type: 'text', text: clip(markdown) }],
          structuredContent: { seriesId, count: eps.length, downloaded: have, episodes: eps }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error getting episodes: ${e.message}` }] };
      }
    }
  );

  // 8. Trigger a command
  server.registerTool(
    'sonarr_trigger_command',
    {
      title: 'Trigger Command',
      description: `Run a Sonarr command. Common ones:
  - SeriesSearch (seriesId) — search indexers for a whole series
  - SeasonSearch (seriesId + seasonNumber) — one season
  - EpisodeSearch (episodeIds) — specific episodes
  - MissingEpisodeSearch — search everything missing
  - RefreshSeries (seriesId optional) — refresh metadata + rescan
  - RescanSeries (seriesId optional) — rescan disk files
  - RenameFiles (seriesId + files) — rename episode files
  - RssSync — fetch indexer RSS now`,
      inputSchema: {
        name: z.string().describe(`Command name, e.g. 'SeriesSearch', 'SeasonSearch', 'EpisodeSearch', 'MissingEpisodeSearch', 'RefreshSeries', 'RescanSeries', 'RenameFiles', 'RssSync'`),
        seriesId: z.number().int().optional().describe('Series internal ID (SeriesSearch, SeasonSearch, RefreshSeries…)'),
        seasonNumber: z.number().int().min(0).optional().describe('Season number (SeasonSearch)'),
        episodeIds: z.array(z.number().int()).optional().describe('Episode internal IDs (EpisodeSearch)'),
        files: z.array(z.number().int()).optional().describe('Episode file IDs (RenameFiles)')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, seriesId, seasonNumber, episodeIds, files }) => {
      try {
        const payload = { name };
        if (seriesId !== undefined) payload.seriesId = seriesId;
        if (seasonNumber !== undefined) payload.seasonNumber = seasonNumber;
        if (episodeIds?.length) payload.episodeIds = episodeIds;
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
    'sonarr_get_profiles_and_paths',
    {
      title: 'Get Profiles & Paths',
      description: 'List quality profiles and root folders — the valid values for sonarr_add_series. (Language profiles only appear on legacy Sonarr v3; v4 removed them.)',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        const profiles = await request('/qualityprofile');
        const roots = await request('/rootfolder');

        // Legacy v3 only: v4 keeps a deprecated stub that returns a single fake "Deprecated" profile.
        let langProfiles = [];
        try {
          const lp = await request('/languageprofile');
          if (Array.isArray(lp) && !(lp.length === 1 && lp[0]?.name === 'Deprecated')) langProfiles = lp;
        } catch { /* endpoint gone — fine */ }

        let md = '### 📋 Sonarr configuration\n\n#### Quality profiles\n';
        md += (profiles || []).map(p => `- **${p.name}** (ID: \`${p.id}\`)`).join('\n') || '- none configured';
        if (langProfiles.length) {
          md += '\n\n#### Language profiles (legacy v3)\n';
          md += langProfiles.map(lp => `- **${lp.name}** (ID: \`${lp.id}\`)`).join('\n');
        }
        md += '\n\n#### Root folders\n';
        md += (roots || []).map(r => `- \`${r.path}\` (free: ${formatBytes(r.freeSpace)})`).join('\n') || '- none configured';
        return {
          content: [{ type: 'text', text: md }],
          structuredContent: { qualityProfiles: profiles, languageProfiles: langProfiles, rootFolders: roots }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error fetching configuration: ${e.message}` }] };
      }
    }
  );
}

// Powers the ▶ Test button
export async function test(settings, { fetchJson }) {
  if (!settings.sonarr_url || !settings.api_key) {
    return { ok: false, message: 'sonarr_url or api_key is missing — set both in Settings.' };
  }
  const cleanUrl = settings.sonarr_url.replace(/\/+$/, '');
  try {
    const data = await fetchJson(`${cleanUrl}/api/v3/system/status`, {
      headers: { 'X