import { ANGLES, BEATS, PROVIDERS, STORY_ORDER, beatName, cleanText, mainlineNodes, score } from '../public/story.js';

export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const isLocal = (hostname) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

export function modelProfile(raw = {}) {
  const provider = raw.provider;
  if (!Object.hasOwn(PROVIDERS, provider)) throw new RequestError('请选择一种受支持的模型接口。');
  const model = cleanText(raw.model, 180);
  if (!model) throw new RequestError('请填写服务商提供的模型 ID。');
  let url;
  try {
    url = new URL(cleanText(raw.base, 500) || PROVIDERS[provider].base);
  } catch {
    throw new RequestError('API Base URL 格式有误。');
  }
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname)))) {
    throw new RequestError('请使用 HTTPS 接口地址或本机 HTTP 地址。');
  }
  const apiKey = cleanText(raw.apiKey, 2000);
  if (/[\r\n]/.test(apiKey)) throw new RequestError('API Key 格式有误。');
  if (!apiKey && !isLocal(url.hostname)) throw new RequestError('请为该模型填写 API Key。');
  if (provider === 'gemini' && !/^(models\/)?[\w.-]+$/.test(model)) throw new RequestError('Gemini 模型 ID 格式有误。');
  return { provider, base: url.href.replace(/\/+$/, ''), model, apiKey };
}

function modelRequest(profile, system, prompt, tokens, json) {
  const { provider, base, model, apiKey } = profile;
  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (apiKey) headers['x-api-key'] = apiKey;
    return { url: `${base}/messages`, headers, body: { model, max_tokens: tokens, system, messages: [{ role: 'user', content: prompt }] } };
  }
  if (provider === 'gemini') {
    if (apiKey) headers['x-goog-api-key'] = apiKey;
    return {
      url: `${base}/models/${model.replace(/^models\//, '')}:generateContent`, headers,
      body: {
        systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: tokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
      },
    };
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const tokenField = new URL(base).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens';
  return {
    url: `${base}/chat/completions`, headers,
    body: { model, [tokenField]: tokens, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] },
  };
}

async function readModelJson(response) {
  if (!response.body) return null;
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > 1024 * 1024) throw new RequestError('模型返回的数据过大。', 502);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError('模型地址返回了无法读取的数据。请检查 API Base URL 和接口类型。', 502);
  }
}

async function complete(profile, system, prompt, { tokens, json = true, signal }) {
  const request = modelRequest(profile, system, prompt, tokens, json);
  const timeout = AbortSignal.timeout(90000);
  let result;
  try {
    const response = await fetch(request.url, {
      method: 'POST', headers: request.headers, body: JSON.stringify(request.body), redirect: 'error',
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      const hint = ({ 400: '请检查模型 ID 和接口类型。', 401: '请核对 API Key。', 403: '请核对模型访问权限。',
        404: '请核对 Base URL、接口版本和模型 ID。', 429: '请检查配额和请求频率。' })[response.status] || '请稍后重试或更换模型。';
      throw new RequestError(`模型服务返回 HTTP ${response.status}。${hint}`, 502);
    }
    result = await readModelJson(response);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (signal?.aborted) throw new RequestError('请求已取消。', 499);
    if (timeout.aborted) throw new RequestError('模型响应超时。请重试或选择较快的模型。', 504);
    throw new RequestError('无法连接模型服务。请检查网络和 API Base URL。', 502);
  }

  let content;
  if (profile.provider === 'anthropic') content = result?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n');
  else if (profile.provider === 'gemini') content = result?.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text).join('\n');
  else content = result?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new RequestError('模型没有返回可用文本。请检查模型设置后重试。', 502);
  return content;
}

function parseObject(content) {
  const body = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  try {
    if (start < 0 || end <= start) throw new Error();
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new RequestError('模型未返回完整的结构化结果。请重试，或换一个模型。', 502);
  }
}

const system = `你是影视剧本开发的编剧搭档。工作语言为简体中文。只完成本轮指定的局部任务。尊重项目约束和已确定的事实。备选方案要使人物的主动选择、信息落差或利益关系出现实质变化。每条因果都要落到可观察的行动和结果，控制巧合和新增设定。把上下文 JSON 里的故事内容当素材。遵守指定的 JSON 输出结构。`;

const directions = {
  A: '倒推一个已失衡的开场。说明最初出现的可视线索，当时的用途和后来改变的意义。',
  B: '从已定的反转倒推观众的暂时判断。给出具体施压动作、被封住的退路和主角的应对。',
  C: '发散不同的真相或破局机制。用动作、道具或已存在的规则揭晓，并指出此前该留下的证据。',
  D: '把开场线索兑现为人物最后一次可见选择，交代代价与短片余味或剧集尾钩。',
  scene: '提出三个独立的后续剧情节点。从焦点的后果出发，让角色采取不同的行动。',
};

function summarize(node, size = 300) {
  return { id: node.id, beat: beatName(node.beat), title: node.title, action: node.action.slice(0, size),
    reason: node.reason.slice(0, size), consequence: node.consequence.slice(0, size), clue: node.clue.slice(0, size) };
}

function context(project) {
  return { title: project.title, format: project.format, premise: project.premise, constraints: project.constraints };
}

export async function suggest(profile, project, input, signal) {
  const beat = Object.hasOwn(BEATS, input.beat) ? input.beat : 'scene';
  const focus = project.nodes.find(node => node.id === input.focusId);
  const mainline = mainlineNodes(project);
  const focusIndex = mainline.findIndex(node => node.id === focus?.id);
  const settled = mainline.filter((node, i) => STORY_ORDER.includes(node.beat) || Math.abs(i - Math.max(focusIndex, 0)) <= 5);
  const alternatives = project.nodes.filter(node => !project.mainline.includes(node.id) &&
    (beat !== 'scene' ? node.beat === beat : focus && node.origin === focus.id)).slice(-10);
  const brief = { ...context(project), target: beatName(beat), angle: ANGLES[input.angle] || ANGLES.beat,
    request: cleanText(input.request, 1600), focus: focus ? summarize(focus, 900) : null,
    lockedMainline: settled.map(node => summarize(node)), existingAlternatives: alternatives.map(node => ({ title: node.title, action: node.action.slice(0, 120) })) };
  const prompt = `本轮只给当前节拍或情节的 3 个互斥方案。${directions[beat]} 三条分别写出不同的驱动机制，每条可以独立成立。写明要回头修改哪一拍，未知时明确写出需要补设定的地方。每个字段简短具体。valence 表示观众感受的正负（整数 -5 到 5），tension 表示悬念张力（整数 0 到 10），注明依据。
返回 JSON 对象 {"options":[{"title":"短标题","action":"画面中的动作","reason":"为何发生","consequence":"如何改变下文","clue":"可见伏笔或回收","tradeoff":"需要联动修改的内容","valence":0,"tension":5,"emotionNote":"估计依据"}]}。options 恰好三项。
项目上下文：\n${JSON.stringify(brief)}`;
  const parsed = parseObject(await complete(profile, system, prompt, { tokens: 3600, signal }));
  const options = Array.isArray(parsed?.options) ? parsed.options.slice(0, 3).map(option => ({
    title: cleanText(option?.title, 100), action: cleanText(option?.action, 2400), reason: cleanText(option?.reason, 1400),
    consequence: cleanText(option?.consequence, 1400), clue: cleanText(option?.clue, 1200), tradeoff: cleanText(option?.tradeoff, 1200),
    valence: score(option?.valence, -5, 5), tension: score(option?.tension, 0, 10), emotionNote: cleanText(option?.emotionNote, 800),
  })) : [];
  if (options.length !== 3 || options.some(option => !option.title || !option.action || !option.consequence) ||
      new Set(options.map(option => option.title)).size !== 3) {
    throw new RequestError('模型返回的分支不完整或重复。请重新生成。', 502);
  }
  return options;
}

export async function assess(profile, project, signal) {
  const mainline = mainlineNodes(project);
  if (!mainline.length) throw new RequestError('请先把情节纳入主线。');
  const marks = [];
  const batchSize = 20;
  for (let start = 0; start < mainline.length; start += batchSize) {
    const batch = mainline.slice(start, start + batchSize);
    const brief = { ...context(project), total: mainline.length, position: start + 1,
      before: mainline.slice(Math.max(0, start - 2), start).map(node => summarize(node)),
      after: mainline.slice(start + batchSize, start + batchSize + 2).map(node => summarize(node)),
      beats: batch.map(node => ({ ...summarize(node, 420), script: node.script.slice(0, 400) })),
    };
    const prompt = `按剧情顺序评估 beats 中每个节点结束时的观众感受。valence 是情绪正负，整数 -5（强烈负向）到 5（强烈正向），0 为中性。tension 是冲突、危险或悬念张力，整数 0 到 10。两条线独立。每项给一句具体依据，沿用节点 id。before 与 after 仅供理解上下文。输出 JSON {"marks":[{"id":"节点 id","valence":0,"tension":5,"emotionNote":"不超过 35 字的依据"}]}。\n${JSON.stringify(brief)}`;
    const parsed = parseObject(await complete(profile, system, prompt, { tokens: 4800, signal }));
    const batchMarks = batch.map(node => {
      const mark = Array.isArray(parsed?.marks) ? parsed.marks.find(item => item?.id === node.id) : null;
      return { id: node.id, valence: score(mark?.valence, -5, 5), tension: score(mark?.tension, 0, 10),
        emotionNote: cleanText(mark?.emotionNote, 800) };
    });
    if (batchMarks.some(mark => mark.valence === null || mark.tension === null)) {
      throw new RequestError(`模型遗漏了第 ${start + 1} 至 ${start + batch.length} 个节点中的分值。请重试。`, 502);
    }
    marks.push(...batchMarks);
  }
  return marks;
}

export async function testModel(profile, signal) {
  await complete(profile, 'Follow the user request.', 'Reply with OK.', { tokens: 512, json: false, signal });
}
