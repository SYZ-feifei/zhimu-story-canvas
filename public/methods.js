const stages = items => items.map(([id, label]) => ({ id, label }));

export const STORY_METHODS = [
  {
    id: "free", name: "自由创作", author: "",
    fit: "已有自己的写法，或想先随手搭建。",
    approach: "从最有感觉的人物、场景或决定开始，按需要把想法连起来。",
    start: "现在最想写的是哪一场、哪个人物，或哪一个难做的决定？",
    stages: stages([]),
  },
  {
    id: "three-act", name: "三幕结构", author: "Syd Field",
    fit: "适合第一次梳理完整故事。",
    approach: "用建置、对抗、解决串起主角的行动。两次重要转折改变故事接下来的方向。",
    start: "先用一句话写下主角想得到什么，什么事迫使他现在行动。",
    sample: {
      question: "主角原本过着什么生活？哪件事迫使他做出决定，进入新的处境？",
      work: "写一场交代人物现状与触发事件的戏，标出主角的第一个决定。",
      check: "这个决定使原来的生活无法照旧。",
    },
    stages: stages([
      ["act-setup","第一幕 · 建置"],
      ["act-confront","第二幕 · 对抗"],
      ["act-resolve","第三幕 · 解决"],
    ]),
  },
  {
    id: "story-circle", name: "故事环", author: "Dan Harmon",
    fit: "适合从人物的欲望、代价和改变出发。",
    approach: "从人物熟悉的处境出发，经由欲望和代价回到某种熟悉的局面，用行动展示改变。",
    start: "写下主角最熟悉的生活方式，以及他此刻想得到的一样东西。",
    sample: {
      question: "哪个日常动作最能让观众看懂主角现在是怎样的人？",
      work: "写一个能代表人物日常的可拍动作。",
      check: "观众从行动看得出他习惯怎样应对事情。",
    },
    stages: stages([
      ["circle-you","熟悉处境"],
      ["circle-need","产生欲望"],
      ["circle-go","进入陌生处境"],
      ["circle-search","尝试和适应"],
      ["circle-find","得到所求"],
      ["circle-take","付出代价"],
      ["circle-return","回到熟悉处境"],
      ["circle-change","显露改变"],
    ]),
  },
  {
    id: "save-the-cat", name: "Save the Cat! 15 节拍", author: "Blake Snyder",
    fit: "适合检查长片的推进节奏和关键转折。",
    approach: "逐拍梳理事件的功能，检查中段变轨、低谷和首尾对照。节点可按故事所需调整。",
    start: "先想开场和结尾的两个可见画面，看主角的处境或行为发生了什么变化。",
    sample: {
      question: "用一个画面表现主角在改变前的状态。",
      work: "写开头的一个镜头或动作。",
      check: "它展示了主角改变前的处境。",
    },
    stages: stages([
      ["cat-opening","开场画面"],
      ["cat-theme","提出主题"],
      ["cat-setup","建立现状"],
      ["cat-catalyst","触发事件"],
      ["cat-debate","犹豫与权衡"],
      ["cat-second","进入第二幕"],
      ["cat-b-story","副线"],
      ["cat-promise","兑现故事卖点"],
      ["cat-midpoint","中点变轨"],
      ["cat-pressure","压力逼近"],
      ["cat-loss","重大失去"],
      ["cat-reflection","低谷反思"],
      ["cat-third","进入第三幕"],
      ["cat-finale","终局行动"],
      ["cat-final-image","结尾画面"],
    ]),
  },
  {
    id: "sequence", name: "剧情序列法", author: "Paul Joseph Gulino",
    fit: "适合中段容易写散的长片和剧集。",
    approach: "把几场戏组成一个有短期目标和结果的序列。这里的八段是起步提示，序列数可随作品调整。",
    start: "任选一段，先写主角眼下要解决的小问题，再写段尾如何回答或改写它。",
    sample: {
      question: "用哪组场景让观众认识人物，并开始关心一个悬而未决的问题？",
      work: "列出两三场建立人物与悬念的戏。",
      check: "本段留下一个可继续追问的问题。",
    },
    stages: stages([
      ["seq-one","第 1 段 · 建立问题"],
      ["seq-two","第 2 段 · 确立目标"],
      ["seq-three","第 3 段 · 第一次行动"],
      ["seq-four","第 4 段 · 改变局势"],
      ["seq-five","第 5 段 · 新难题"],
      ["seq-six","第 6 段 · 兑现代价"],
      ["seq-seven","第 7 段 · 最终尝试"],
      ["seq-eight","第 8 段 · 回答问题"],
    ]),
  },
  {
    id: "snowflake", name: "雪花法", author: "Randy Ingermanson",
    fit: "适合只有一句灵感、还没有大纲的项目。",
    approach: "把从小说写作借来的逐层扩写流程用在剧本上，从一句话长成梗概、人物关系、分场和初稿。",
    start: "先写一句含有主角、目标和主要阻力的故事种子。",
    sample: {
      question: "能否用一句话说明谁想做成什么事，最大的阻力来自哪里？",
      work: "写一句包含人物、目标和主要阻力的故事种子。",
      check: "听众能用一句话复述这个故事在追什么。",
    },
    stages: stages([
      ["snow-sentence","一句话故事"],
      ["snow-synopsis","短梗概"],
      ["snow-characters","人物与关系"],
      ["snow-scenes","分场提纲"],
      ["snow-draft","初稿片段"],
    ]),
  },
  {
    id: "reverse-four", name: "逆向反转四拍", author: "剧本创作 Skill 4.0",
    fit: "适合短剧、悬疑和需要集中设计反转的短片。",
    approach: "先想明白底牌，再设计合理误判和压力，回头铺设开场证据，最后兑现伏笔和尾钩。",
    start: "先写下观众原以为发生了什么，以及哪件可被看见的事会证明他们猜错了。",
    sample: {
      question: "真相是什么？哪个道具、动作或已存在的规则能在画面里证实它？",
      work: "列三种反转真相，为每种写出能证实它的可见证据。",
      check: "真相成立的条件能够在前文埋下。",
    },
    stages: stages([
      ["reverse-c","C · 反转底牌"],
      ["reverse-b","B · 误导与施压"],
      ["reverse-a","A · 失衡开场"],
      ["reverse-d","D · 兑现与尾钩"],
    ]),
  },
];

export function methodFor(id, guide) {
  const method = STORY_METHODS.find(item => item.id === id) || STORY_METHODS[0];
  const details = guide?.[method.id]?.stages;
  return details ? { ...method, stages: method.stages.map(stage => ({ ...stage, ...details[stage.id] })) } : method;
}

export function stageFor(methodId, stageId, guide) {
  const stage = methodFor(methodId, guide).stages.find(item => item.id === stageId);
  return stage;
}

export function normalizeStage(id) {
  return STORY_METHODS.some(method => method.stages.some(stage => stage.id === id)) ? id : '';
}

export function normalizeGuide(value) {
  if (!value || typeof value !== 'object') throw new Error('创作方法包格式有误。');
  const guide = {};
  for (const method of STORY_METHODS.filter(item => item.stages.length)) {
    const stages = {};
    for (const stage of method.stages) {
      const details = value[method.id]?.stages?.[stage.id];
      const keys = ['question', 'work', 'check'];
      if (!keys.every(key => typeof details?.[key] === 'string' && details[key].trim().length && details[key].length <= 500)) {
        throw new Error('创作方法包缺少阶段指引。');
      }
      stages[stage.id] = Object.fromEntries(keys.map(key => [key, details[key].trim()]));
    }
    guide[method.id] = { stages };
  }
  return guide;
}
