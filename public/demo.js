import { makeNode } from './story.js';

export function demoProject() {
  return {
    schema: 1, id: 'rain-demo', title: '雨夜失物招领', format: '短片', cover: 'rain',
    premise: '车站停运前十分钟，一把红伞让值班员林栀发现，一份本该留档的认领记录被人抹掉了。',
    constraints: '故事发生在末班车驶离前的失物招领处。主要人物是林栀、来客和站长。红伞贯穿全片。',
    mainline: ['opening', 'pressure', 'reveal', 'payoff'],
    links: [], proposals: [], analysisNotes: '', sourceName: '',
    nodes: [
      { id: 'opening', beat: 'A', title: '最后一张认领单', action: '铁帘落到一半，林栀伸手从碎纸口抽回一张湿透的认领单。',
        reason: '交班前她必须清点未领物品。认领单的存根撕口让她停下碎纸机。', consequence: '她按住铁帘开关，把最后一个来客留在窗口。',
        clue: '认领单有两联，存根带编号与签名。', valence: -1, tension: 3, emotionNote: '停运前的异常制造轻度不安。', x: 0, y: 0 },
      { id: 'pressure', beat: 'B', title: '来客报出编号', action: '来客准确背出红伞的编号。站长从她手里抽走钥匙，催她销毁夜班账册。',
        reason: '来客似乎具备认领资格，站长又握着关窗的钥匙。', consequence: '林栀得在铁帘落下之前核对红伞和账册。',
        clue: '来客说得出编号，却说错了伞柄的颜色。', valence: -3, tension: 7, emotionNote: '倒计时、钥匙和可疑的来客同时施压。', x: 230, y: 0 },
      { id: 'reveal', beat: 'C', title: '伞骨里是存根', action: '林栀撑开红伞。伞骨里滑出半联存根，撕口正好接上那张湿单。',
        reason: '来客在意编号却没看伞柄，林栀改查伞内部。', consequence: '存根上的站长签名使销档行为变得可追溯。',
        clue: '用两联单的撕口吻合，让观众自己认出消失的记录。', tradeoff: '开场要拍清认领单的撕口和两联制。',
        fixedDetails: '红伞内侧藏着被撕掉的存根，存根上有站长签名。',
        valence: 2, tension: 9, emotionNote: '证据出现带来短暂掌控感，站长仍然在场。', x: 460, y: 0 },
      { id: 'payoff', beat: 'D', title: '把证据贴在窗外', action: '林栀把拼好的两联贴在玻璃外侧，把红伞挂回未认领区。来客举起手机。',
        reason: '只要证据留在铁帘内，站长就能拿回它。', consequence: '落帘后，外侧玻璃上的签名仍然可以被拍下来。',
        clue: '回收铁帘、编号和两联单。', valence: 3, tension: 4, emotionNote: '危机解除，最后一个动作保留余味。', x: 690, y: 0 },
      { id: 'option-witness', beat: 'C', title: '来客是留证的人', action: '来客递出自己那一联。林栀把两张纸并排放下，两张都有站长签名，时间却差了一夜。',
        reason: '来客知道编号，因为前一晚就是他拿着红伞试过认领。', consequence: '来客愿意实名作证，林栀获得第三方的支撑。',
        clue: '两份签名相同、时间不同的收据。', tradeoff: '中段需要表现来客一直护着外衣内袋，结尾要兑现他留下作证。',
        valence: 1, tension: 8, emotionNote: '同盟形成，眼前风险仍在。', origin: 'reveal', x: 344, y: 238 },
      { id: 'option-rule', beat: 'C', title: '封存印记在伞面', action: '站长把剪刀伸向伞骨。林栀转动撑开的伞，灯光照出内侧的封存章。',
        reason: '归档时必须给物品加印。来客所谓的遗失日期早于封存时间。', consequence: '林栀能用当班记录反驳站长，前半段需要交代封存规则。',
        clue: '同一枚印章在纸面和伞布上重复出现。', tradeoff: '开场增加一次盖章动作，结尾改为让来客拍下伞布印记。',
        valence: 0, tension: 9, emotionNote: '毁证动作压缩了揭晓时间。', origin: 'reveal', x: 578, y: 238 },
    ].map(makeNode),
  };
}
