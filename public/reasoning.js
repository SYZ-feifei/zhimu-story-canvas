const labels = {
  none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', '-1': '动态', '0': '关闭',
};
const lowToHigh = ['low', 'medium', 'high'];
const upToMax = [...lowToHigh, 'xhigh', 'max'];
const noneToXhigh = ['none', ...lowToHigh, 'xhigh'];
const gptLevels = {
  'gpt-6.1-sol': upToMax, 'gpt-6-astra': upToMax,
  'gpt-6.1-terra': ['none', ...upToMax], 'gpt-6-sol': ['none', ...upToMax], 'gpt-6-luna': ['none', ...upToMax],
  'gpt-5.6': ['none', ...upToMax], 'gpt-5.6-sol': ['none', ...upToMax],
  'gpt-5.6-terra': ['none', ...upToMax], 'gpt-5.6-luna': ['none', ...upToMax],
  'gpt-5.5': noneToXhigh, 'gpt-5.4': noneToXhigh, 'gpt-5.4-mini': noneToXhigh, 'gpt-5.4-nano': noneToXhigh,
  'gpt-5.2': noneToXhigh, 'gpt-5.1': ['none', ...lowToHigh],
  'gpt-5': ['minimal', ...lowToHigh], 'gpt-5-mini': ['minimal', ...lowToHigh], 'gpt-5-nano': ['minimal', ...lowToHigh],
  'gpt-5-pro': ['high'], 'gpt-5.2-pro': ['medium', 'high', 'xhigh'],
  'gpt-5.4-pro': ['medium', 'high', 'xhigh'], 'gpt-5.5-pro': ['medium', 'high', 'xhigh'],
  'gpt-5.2-codex': [...lowToHigh, 'xhigh'], 'gpt-5.3-codex': [...lowToHigh, 'xhigh'],
  o1: lowToHigh, 'o1-mini': [], o3: lowToHigh, 'o3-mini': lowToHigh, 'o4-mini': lowToHigh,
};
const geminiLevels = {
  'gemini-3-pro-preview': ['low', 'high'], 'gemini-3.1-pro-preview': lowToHigh,
  'gemini-3-flash-preview': ['minimal', ...lowToHigh], 'gemini-3.1-flash-lite': ['minimal', ...lowToHigh],
  'gemini-3.5-flash': ['minimal', ...lowToHigh], 'gemini-3.5-flash-lite': ['minimal', ...lowToHigh],
  'gemini-3.6-flash': ['minimal', ...lowToHigh], 'gemini-3.8-flash': lowToHigh,
  'gemini-4-carbon': lowToHigh, 'gemini-4-argon': lowToHigh, 'gemini-4-hydrogen': [...lowToHigh, 'xhigh'],
};
const claudeExtendedBudget = { low: 2048, medium: 4096, high: 8192 };
const claudeLevels = {
  'claude-opus-4-5': lowToHigh, 'claude-opus-4-6': [...lowToHigh, 'max'], 'claude-sonnet-4-6': [...lowToHigh, 'max'],
  'claude-opus-4-7': upToMax, 'claude-opus-4-8': upToMax, 'claude-opus-5': upToMax, 'claude-opus-5-5': upToMax,
  'claude-sonnet-5': upToMax, 'claude-sonnet-5-5': upToMax, 'claude-haiku-5-5': upToMax,
};

const canonical = profile => profile.model.toLowerCase().replace(/^(models|openai)\//, '').replace(/-(?:\d{4}-\d\d-\d\d|\d{8})$/, '');
const officialOpenAI = base => /^https:\/\/api\.openai\.com(?:\/|$)/.test(base || '');
export const usesResponses = profile => profile.mode === 'responses' || (profile.provider === 'openai' && officialOpenAI(profile.base) &&
  /^gpt-5(?:(?:\.[245])?-pro|\.[123]-codex(?:-mini|-max)?)$/.test(canonical(profile)));

export const cleanEffort = value => typeof value === 'string' && /^(?:[a-z][a-z0-9_-]{0,23}|-1|[0-9]{1,5})$/.test(value) ? value : '';

export function effortLabel(effort) {
  if (!effort) return '默认';
  if (Object.hasOwn(labels, effort)) return labels[effort];
  return /^\d+$/.test(effort) ? Number(effort).toLocaleString('en-US') : effort;
}

function support(profile) {
  if (!profile?.model) return null;
  const model = canonical(profile);
  if (profile.provider === 'openai' || profile.provider === 'ollama') {
    if (profile.reasoningLevels === 'off') return null;
    const override = Array.isArray(profile.reasoningLevels) ? profile.reasoningLevels : null;
    const type = usesResponses(profile) ? 'responses' : 'chat';
    const builtin = Object.hasOwn(gptLevels, model) ? gptLevels[model] : null;
    if (override || builtin) return { type, levels: override || builtin };
    if (/^(?:deepseek-flash|deepseek-v4-(?:flash|pro)|deepseek-v4\.1-flash)$/.test(model)) {
      return { type, levels: ['none', 'low', 'high', 'max'] };
    }
    if (profile.provider === 'ollama' && /^gpt-oss(?::[\w.-]+)?$/.test(model)) return { type, levels: lowToHigh };
  } else if (profile.provider === 'gemini') {
    if (Object.hasOwn(geminiLevels, model)) return { type: 'gemini-level', levels: geminiLevels[model] };
    if (/^gemini-2\.5-(?:pro|flash(?:-lite)?)(?:-preview(?:-\d\d-\d{4})?)?$/.test(model)) {
      const canDisable = !model.startsWith('gemini-2.5-pro');
      return { type: 'gemini-budget', levels: ['-1', ...(canDisable ? ['0'] : []), '1024', '4096', '8192', '16384'] };
    }
  } else if (profile.provider === 'anthropic' && Object.hasOwn(claudeLevels, model)) {
    return { type: 'claude', levels: claudeLevels[model], adaptive: model !== 'claude-opus-4-5' };
  }
  return null;
}

export function effortChoices(profile) {
  const config = support(profile);
  if (!config?.levels.length) return [];
  return [['', '默认'], ...config.levels.map(level => [level, effortLabel(level)])];
}

export function validEffort(profile, value) {
  return support(profile)?.levels.includes(value) ? value : '';
}

export function reasoningParameters(profile, effort) {
  if (!effort) return {};
  const config = support(profile);
  if (!config?.levels.includes(effort)) return null;
  if (config.type === 'responses') return { reasoning: { effort } };
  if (config.type === 'chat') return { reasoning_effort: effort };
  if (config.type === 'claude') {
    const thinking = config.adaptive ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: claudeExtendedBudget[effort] };
    return { output_config: { effort }, thinking };
  }
  if (config.type === 'gemini-level') return { thinkingConfig: { thinkingLevel: effort.toUpperCase() } };
  return { thinkingConfig: { thinkingBudget: Number(effort) } };
}
