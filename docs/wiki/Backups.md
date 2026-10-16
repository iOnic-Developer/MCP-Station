# Backups, exports, and recovery

**Three formats serve different purposes.** Choose a full backup to preserve additional
service accounts and usage.

| Format | Included | Not included / caution |
| --- | --- | --- |
| Full station `.tar.gz` | Station data, OAuth state, persisted key, shared source; account registry and usage | External Files storage, externally supplied environment secrets; private recovery material. |
| Portable JSON | Instructions, provider/model configuration, installed sources' default-account settings | No additional account records, usage, or module source; secrets only if explicitly requested. |
| Module ZIP | Shareable source, manifest, and module documentation | Managed settings/chat and account records excluded; manually embedded secrets still require review. |

## Private recovery

1. Create a full station backup from Backups before changing image/channel or restoring state.
2. Store a private off-host copy. The archive contains credentials and the persisted encryption key.
3. Preserve deployment configuration and any externally supplied `SESSION_SECRET` separately.
4. Back up the configured Files root and any other external storage independently.
5. Validate restore in an isolated instance with separate volumes before changing production.

Restoring changes state and module files. Expect access grants and credentials from the backup to
return. Do not restore untrusted archives, publish backups as examples, or assume a switch back to
an older image reverses newer state safely. The HTTP backup route flushes state/usage first.
Internal backups exclude the backups directory and trash; they are not a recursive archive history.

## Portable configuration is not a full backup

`/api/export` defaults to masked secret fields. Explicit secret inclusion exports plaintext secrets,
so treat that result as sensitive. Import matches already-installed source IDs and skips masked
secret placeholders. It cannot rebuild source code, extra service accounts, or usage history.

## Sharing a module

Export its ZIP, review every source/doc file for embedded private values, and give the recipient the
source—not a station backup. They install the folder, reload, and configure their own settings.
Managed `.config.json` and `.chat.json` are excluded; that is not a general source-code secret scanner.

[Accounts](Accounts) · [Versions and Images](Versions-and-Images)
