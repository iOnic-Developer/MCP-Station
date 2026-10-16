/** Local bundle boundary; not a sandbox or a substitute for scoped upstream credentials. */
export function configurationError(id, settings) {
  const has = (key) => typeof settings[key] === 'string' && settings[key].trim() !== '';
  const required = { todoist: ['api_key'], github: ['pat'], dockerhub: ['username', 'pat'],
    pushover: ['api_token', 'user_key'], protonpass: ['personal_access_token'],
    cloudflare: ['api_token', 'account_id'] };
  if (id === 'gmail' && !(has('access_token') || ['client_id', 'client_secret', 'refresh_token'].every(has))) {
    return 'Configure access_token OR client_id, client_secret and refresh_token';
  }
  if (id === 'gdrive' && !(has('access_token') || (has('client_id') && has('client_secret') &&
    [1, 2, 3].some((i) => has(`account${i}_refresh_token`) && !['disabled', 'false', false].includes(settings[`account${i}_enabled`]))))) {
    return 'Configure access_token OR client_id, client_secret and an enabled account refresh token';
  }
  const missing = (required[id] || []).filter((key) => !has(key));
  return missing.length ? `Configure ${missing.join(', ')}` : '';
}

export function normalizeResult(result) {
  if (!result || typeof result !== 'object') throw new Error('Invalid module result');
  if (Object.hasOwn(result, 'structuredContent')) {
    const value = result.structuredContent;
    result = { ...result, structuredContent: Array.isArray(value) ? { items: value } :
      value && typeof value === 'object' ? value : { value: value ?? null } };
  }
  if (result.content?.some((item) => item.type === 'text' && /^Error\b/i.test(item.text))) {
    result = { ...result, isError: true };
  }
  return result;
}

export function guardedServer(server, id, getSettings, omitted = []) {
  return new Proxy(server, { get(target, key) {
    if (key !== 'registerTool') {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }
    return (name, spec, handler) => {
      if (omitted.includes(name)) return;
      return target.registerTool(name, spec, async (...args) => {
        const missing = configurationError(id, getSettings());
        if (missing) return { isError: true, content: [{ type: 'text', text: `Error: ${missing}. Open MCP Station → ${id} → Settings.` }] };
        if (id === 'protonpass') {
          const check = (v) => typeof v === 'string' ? !/[\0\r\n]/.test(v) && !/^--?[a-z]/i.test(v) :
            Array.isArray(v) ? v.every(check) : v && typeof v === 'object' ? Object.values(v).every(check) : true;
          if (!check(args[0])) return { isError: true, content: [{ type: 'text', text: 'Error: CLI values must not contain control characters or start with an option.' }] };
        }
        try {
          const result = normalizeResult(await handler(...args));
          if (!result.isError) return result;
          const secrets = Object.entries(getSettings()).filter(([key, value]) => /pat|token|secret|api_key|user_key/i.test(key) && typeof value === 'string' && value);
          const redact = (v) => typeof v === 'string' ? secrets.reduce((text, [, secret]) => text.split(secret).join('[redacted]'), v) :
            Array.isArray(v) ? v.map(redact) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, value]) => [k, redact(value)])) : v;
          return redact(result);
        }
        catch { return { isError: true, content: [{ type: 'text', text: `Error: ${id} operation failed. Check settings and service permissions.` }] }; }
      });
    };
  } });
}
