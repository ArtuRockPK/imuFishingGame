'use strict';
// =====================================================================
//  ПЕРЕВОДЫ: все тексты игры на всех языках
//
//  В коде текст никогда не пишется напрямую - только через T('ключ'):
//    say(T('msg_escaped'), C.bad);
//  Если в строке есть {что-то}, его подставляют так:
//    T('result_line', { n: 5, kg: '3.20' })
//
//  Новая строка = новый блок в STRINGS со ВСЕМИ языками из LANGUAGES.
//  Если какого-то перевода не хватает, в консоли (F12) будет предупреждение,
//  а в игре покажется английский вариант.
//
//  Новый язык: добавьте его в LANGUAGES и допишите в каждый блок STRINGS.
//  Тексты на сцене (подсказки, сообщения) пишем ЗАГЛАВНЫМИ - так в 8-битном стиле.
// =====================================================================

const LANGUAGES = [
  { id: 'en', name: 'English' },     // первый - язык по умолчанию
  { id: 'ru', name: 'Русский' },
  { id: 'zh', name: '中文' },
  { id: 'ja', name: '日本語' },
];

const STRINGS = {
  // ---------- Стартовый экран ----------
  title:            { en: 'Pixel Fishing', ru: 'Рыбалка', zh: '像素钓鱼', ja: 'ピクセル釣り' },
  choose_language:  { en: 'Choose language', ru: 'Выбери язык', zh: '选择语言', ja: '言語を選んでください' },
  choose_difficulty:{ en: 'Choose difficulty', ru: 'Выбери сложность', zh: '选择难度', ja: '難易度を選んでください' },
  diff_easy:        { en: 'Easy', ru: 'Лёгкий', zh: '简单', ja: 'かんたん' },
  diff_normal:      { en: 'Normal', ru: 'Нормальный', zh: '普通', ja: 'ふつう' },
  diff_epic:        { en: 'Epic', ru: 'Эпический', zh: '史诗', ja: 'エピック' },
  diff_wildwest:    { en: 'Fastest Hand in the Wild West', ru: 'Самая быстрая рука на Диком Западе',
                      zh: '狂野西部最快的手', ja: '西部一の早撃ち' },
  hook_window:      { en: 'Hook window: {s} s', ru: 'Окно подсечки: {s} с', zh: '提竿时间：{s} 秒', ja: 'アワセ猶予：{s} 秒' },
  goal_text:        { en: 'Catch {kg} kg of fish. Every fish that gets away takes a worm. No worms left - game over.',
                      ru: 'Налови {kg} кг рыбы. Каждая сорвавшаяся рыба уносит червячка. Червячки кончились - проигрыш.',
                      zh: '钓到 {kg} 公斤鱼。每跑掉一条鱼就会失去一条蚯蚓。蚯蚓用完，游戏结束。',
                      ja: '魚を合計 {kg} kg 釣ろう。逃げられるたびにミミズが1匹減る。ミミズがなくなったらゲームオーバー。' },
  connect_text:     { en: 'Connect your controller (StickS3, StickC Plus2 or Cardputer ADV) via Bluetooth to start.',
                      ru: 'Подключи контроллер (StickS3, StickC Plus2 или Cardputer ADV) по Bluetooth, чтобы начать.',
                      zh: '通过蓝牙连接控制器（StickS3、StickC Plus2 或 Cardputer ADV）开始游戏。',
                      ja: 'Bluetooth でコントローラー（StickS3・StickC Plus2・Cardputer ADV）を接続してスタート。' },
  btn_connect:      { en: 'Connect controller', ru: 'Подключить контроллер', zh: '连接控制器', ja: 'コントローラーを接続' },
  btn_keyboard:     { en: 'Play with keyboard (test)', ru: 'Играть с клавиатуры (тест)', zh: '使用键盘游玩（测试）', ja: 'キーボードで遊ぶ（テスト）' },
  btn_back:         { en: 'Back', ru: 'Назад', zh: '返回', ja: '戻る' },
  btn_reconnect:    { en: 'Reconnect', ru: 'Переподключить', zh: '重新连接', ja: '再接続' },
  paused:           { en: 'Paused', ru: 'Пауза', zh: '已暂停', ja: '一時停止' },
  disconnected:     { en: 'The controller disconnected.', ru: 'Контроллер отключился.', zh: '控制器已断开。', ja: 'コントローラーの接続が切れました。' },
  check_stick:      { en: 'Make sure the controller is on.', ru: 'Проверь, что контроллер включён.', zh: '请确认控制器已开机。', ja: 'コントローラーの電源を確認してください。' },
  no_bluetooth:     { en: 'Web Bluetooth is not available: open this page in Chrome or Edge.',
                      ru: 'Web Bluetooth недоступен: открой страницу в Chrome или Edge.',
                      zh: '无法使用 Web Bluetooth：请在 Chrome 或 Edge 中打开本页面。',
                      ja: 'Web Bluetooth が使えません。Chrome または Edge で開いてください。' },
  searching:        { en: 'Looking for the controller...', ru: 'Поиск контроллера...', zh: '正在搜索控制器...', ja: 'コントローラーを探しています...' },
  connecting:       { en: 'Connecting...', ru: 'Подключение...', zh: '正在连接...', ja: '接続中...' },
  error:            { en: 'Error: {msg}', ru: 'Ошибка: {msg}', zh: '错误：{msg}', ja: 'エラー：{msg}' },

  // ---------- Подсказки вверху экрана ----------
  hint_aim_x:       { en: 'DOUBLE TAP - PICK A SPOT', ru: 'ДВОЙНОЙ ТАП - ВЫБОР МЕСТА', zh: '双击 - 选择位置', ja: 'ダブルタップ：場所を選ぶ' },
  hint_aim_y:       { en: 'DOUBLE TAP - DISTANCE', ru: 'ДВОЙНОЙ ТАП - ДАЛЬНОСТЬ', zh: '双击 - 选择距离', ja: 'ダブルタップ：距離を選ぶ' },
  hint_ready:       { en: 'SWING THE ROD!', ru: 'ВЗМАХНИ УДОЧКОЙ!', zh: '挥竿！', ja: '竿を振れ！' },
  hint_waiting:     { en: 'WAITING FOR A BITE...', ru: 'ЖДЁМ ПОКЛЁВКУ...', zh: '等待鱼咬钩...', ja: 'アタリを待つ...' },
  hint_resting:     { en: 'RESTING... BITES COME FASTER', ru: 'ОТДЫХАЕМ... КЛЮЁТ БЫСТРЕЕ', zh: '休息中... 鱼咬钩更快', ja: 'ひと休み... アタリが早くなる' },
  hint_bite_jerk:   { en: 'JERK THE STICK!', ru: 'РЕЗКО ДЁРНИ СТИК!', zh: '猛拉手柄！', ja: 'スティックを素早く引け！' },
  hint_bite_turn:   { en: 'A BITE! TURN THE STICK!', ru: 'КЛЮЁТ! ПОВЕРНИ СТИК!', zh: '咬钩了！转动手柄！', ja: 'アタリ！スティックを回せ！' },
  hint_tension:     { en: 'TENSION! REEL SLOWLY!', ru: 'НАТЯЖЕНИЕ! КРУТИ МЕДЛЕННО!', zh: '鱼线绷紧！慢慢转！', ja: 'テンション！ゆっくり巻け！' },
  hint_fight:       { en: 'SPIN THE REEL!', ru: 'КРУТИ КАТУШКУ!', zh: '快转线轮！', ja: 'リールを巻け！' },
  hint_bait_x:      { en: 'DOUBLE TAP - BAIT SPOT', ru: 'ДВОЙНОЙ ТАП - МЕСТО ПРИКОРМКИ', zh: '双击 - 选择打窝位置', ja: 'ダブルタップ：撒く場所' },
  hint_bait_y:      { en: 'DOUBLE TAP - BAIT DISTANCE', ru: 'ДВОЙНОЙ ТАП - ДАЛЬНОСТЬ ПРИКОРМКИ', zh: '双击 - 打窝距离', ja: 'ダブルタップ：撒く距離' },
  hint_bait_throw:  { en: 'JERK THE STICK - THROW BAIT!', ru: 'РЫВОК - БРОСЬ ПРИКОРМКУ!', zh: '猛甩手柄 - 抛出鱼饵！', ja: 'スティックを振れ：エサを投げろ！' },
  hint_campfire_blow: { en: 'BLOW INTO THE STICK - FAN THE FIRE!', ru: 'ДУЙ В СТИК - РАЗДУЙ КОСТЁР!', zh: '对着手柄吹气 - 把火吹旺！', ja: 'スティックに息を吹け：火をおこせ！' },
  hint_campfire_cook: { en: 'TWIST THE STICK - TURN THE SPIT!', ru: 'ВРАЩАЙ СТИК - КРУТИ ВЕРТЕЛ!', zh: '旋转手柄 - 转动烤架！', ja: 'スティックを回せ：串を回せ！' },
  hint_campfire_eat:  { en: 'BON APPETIT!', ru: 'ПРИЯТНОГО АППЕТИТА!', zh: '开动吧！', ja: 'いただきます！' },
  hint_bucket:      { en: 'DROP THE STICK - INTO THE BUCKET!', ru: 'РЕЗКО ОПУСТИ СТИК - В ВЕДРО!', zh: '快速放下手柄 - 放进桶里！', ja: 'スティックを下ろせ：バケツへ！' },
  hint_buzz:        { en: 'BZZZZZ...', ru: 'ЗЗЗЗЗ...', zh: '嗡嗡嗡……', ja: 'プーン……' },
  hint_mosquito:    { en: 'SWAT THE MOSQUITO! (JERK)', ru: 'ПРИХЛОПНИ КОМАРА! (РЫВОК)', zh: '拍死蚊子！（猛甩）', ja: '蚊を叩け！（振り）' },
  hint_photo:       { en: 'DOUBLE TAP - NEXT', ru: 'ДВОЙНОЙ ТАП - ДАЛЬШЕ', zh: '双击 - 继续', ja: 'ダブルタップ：次へ' },
  hint_new_game:    { en: 'DOUBLE TAP - NEW GAME', ru: 'ДВОЙНОЙ ТАП - НОВАЯ ИГРА', zh: '双击 - 新游戏', ja: 'ダブルタップ：ニューゲーム' },

  // ---------- Сообщения по центру ----------
  msg_jerk:         { en: 'STRIKE HARD!', ru: 'РЕЗКО ПОДСЕКАЙ!', zh: '用力提竿！', ja: '強くアワセろ！' },
  msg_hooked:       { en: 'GOT IT! TURN!', ru: 'ЕСТЬ! КРУТИ!', zh: '上钩了！转！', ja: 'かかった！回せ！' },
  msg_missed:       { en: 'TOO SLOW!', ru: 'НЕ УСПЕЛ ПОДСЕЧЬ!', zh: '太慢了！', ja: '遅すぎた！' },
  msg_early:        { en: 'NO BITE! WORM LOST!', ru: 'НЕ КЛЕВАЛО! ЧЕРВЯЧОК СОРВАЛСЯ!', zh: '还没咬钩！蚯蚓掉了！', ja: 'アタリなし！ミミズが外れた！' },
  msg_bait:         { en: 'GROUNDBAIT IN THE BAG!', ru: 'В ПАКЕТЕ ПРИКОРМКА!', zh: '袋子里有鱼饵！', ja: '袋の中に寄せエサ！' },
  msg_bait_ready:   { en: 'SPOT BAITED!', ru: 'МЕСТО ПРИКОРМЛЕНО!', zh: '打窝成功！', ja: 'ポイントに撒いた！' },
  msg_snapped:      { en: 'THE LINE SNAPPED!', ru: 'ЛЕСКА ПОРВАЛАСЬ!', zh: '鱼线断了！', ja: 'ラインが切れた！' },
  msg_escaped:      { en: 'THE FISH GOT AWAY!', ru: 'РЫБКА СОРВАЛАСЬ!', zh: '鱼跑了！', ja: '逃げられた！' },
  msg_bucket:       { en: 'IN THE BUCKET!', ru: 'В ВЕДРЕ!', zh: '进桶了！', ja: 'バケツに入った！' },
  msg_night:        { en: 'NIGHT FALLS. LIGHT A FIRE!', ru: 'НОЧЬ. ПОРА РАЗВЕСТИ КОСТЁР!', zh: '夜幕降临，生火吧！', ja: '夜だ。火をおこそう！' },
  msg_fire_lit:     { en: 'THE FIRE IS BURNING!', ru: 'КОСТЁР ГОРИТ!', zh: '火烧起来了！', ja: '火がついた！' },
  msg_cooked:       { en: 'THE FISH IS READY!', ru: 'РЫБА ГОТОВА!', zh: '鱼烤好了！', ja: '焼けた！' },
  msg_yummy:        { en: 'YUMMY!', ru: 'ВКУСНО!', zh: '真香！', ja: 'うまい！' },
  msg_cat:          { en: 'THE CAT STOLE IT!', ru: 'КОТ УКРАЛ РЫБУ!', zh: '猫把鱼偷走了！', ja: '猫に盗まれた！' },
  msg_swatted:      { en: 'SPLAT!', ru: 'ПРИХЛОПНУЛ!', zh: '啪！', ja: 'パチン！' },
  msg_mosquito_bait: { en: 'MOSQUITO FOR BAIT!', ru: 'КОМАР ПОЙДЁТ НА ПРИКОРМ!', zh: '用蚊子打窝！', ja: '蚊で寄せエサだ！' },
  msg_mosquito_gone: { en: 'HEE-HEE! IT FLEW AWAY...', ru: 'ХИ-ХИ! УЛЕТЕЛ...', zh: '嘻嘻！飞走了……', ja: 'ヒヒッ！逃げられた……' },
  msg_bag:          { en: 'A BAG OF WORMS!', ru: 'ПАКЕТ С ЧЕРВЯЧКАМИ!', zh: '一袋蚯蚓！', ja: 'ミミズの袋だ！' },

  // ---------- Итоги ----------
  gameover_title:   { en: 'OUT OF WORMS!', ru: 'ЧЕРВЯЧКИ КОНЧИЛИСЬ!', zh: '蚯蚓用完了！', ja: 'ミミズ切れ！' },
  win_title:        { en: 'YOU WIN!', ru: 'ПОБЕДА!', zh: '胜利！', ja: 'クリア！' },
  result_line:      { en: 'FISH: {n}  WEIGHT: {kg} KG', ru: 'РЫБ: {n}  ВЕС: {kg} КГ', zh: '鱼：{n} 条  重量：{kg} 公斤', ja: '魚：{n} 匹  重さ：{kg} kg' },

  // ---------- Мелочи на экране ----------
  kg:               { en: 'KG', ru: 'КГ', zh: '公斤', ja: 'kg' },
  stick_still:      { en: 'STILL', ru: 'ПОКОЙ', zh: '静止', ja: '静止' },
  stick_moving:     { en: 'MOVING', ru: 'ДВИЖЕНИЕ', zh: '移动', ja: '移動中' },
  item_bag:         { en: 'BAG', ru: 'ПАКЕТ', zh: '塑料袋', ja: 'ビニール袋' },

  // ---------- Редкость рыбы ----------
  rarity_common:    { en: 'COMMON', ru: 'ОБЫЧНАЯ', zh: '普通', ja: 'ノーマル' },
  rarity_rare:      { en: 'RARE', ru: 'РЕДКАЯ', zh: '稀有', ja: 'レア' },
  rarity_elite:     { en: 'ELITE', ru: 'ЭЛИТНАЯ', zh: '精英', ja: 'エリート' },
  rarity_epic:      { en: 'EPIC', ru: 'ЭПИЧЕСКАЯ', zh: '史诗', ja: 'エピック' },

  // ---------- Виды рыбы ----------
  fish_perch:       { en: 'PERCH', ru: 'ОКУНЬ', zh: '鲈鱼', ja: 'パーチ' },
  fish_crucian:     { en: 'CRUCIAN', ru: 'КАРАСЬ', zh: '鲫鱼', ja: 'フナ' },
  fish_roach:       { en: 'ROACH', ru: 'ПЛОТВА', zh: '拟鲤', ja: 'ローチ' },
  fish_bream:       { en: 'BREAM', ru: 'ЛЕЩ', zh: '鳊鱼', ja: 'ブリーム' },
  fish_pike:        { en: 'PIKE', ru: 'ЩУКА', zh: '狗鱼', ja: 'パイク' },
  fish_carp:        { en: 'CARP', ru: 'САЗАН', zh: '鲤鱼', ja: 'コイ' },
  fish_catfish:     { en: 'CATFISH', ru: 'СОМ', zh: '鲶鱼', ja: 'ナマズ' },
};

// ---------- Текущий язык (запоминается в браузере) ----------
let lang = LANGUAGES[0].id;
try {
  const saved = localStorage.getItem('fishing.lang');
  if (LANGUAGES.some(l => l.id === saved)) lang = saved;
} catch (_) { /* браузер не даёт хранить - не страшно */ }

function setLanguage(id) {
  lang = id;
  document.documentElement.lang = id;
  try { localStorage.setItem('fishing.lang', id); } catch (_) {}
  // Шрифт для иероглифов подгружаем заранее, чтобы текст на сцене сразу был правильным
  if (id === 'zh' || id === 'ja') document.fonts.load('16px "DotGothic16"', '釣鱼魚');
}

// Взять текст по ключу на текущем языке и подставить {переменные}
function T(key, vars) {
  const s = STRINGS[key];
  if (!s) { console.warn('Нет строки:', key); return key; }
  let str = s[lang] !== undefined ? s[lang] : s[LANGUAGES[0].id];
  if (vars) for (const k in vars) str = str.split('{' + k + '}').join(vars[k]);
  return str;
}

// Проверка при загрузке: у каждой строки должны быть все языки
for (const key in STRINGS) {
  for (const l of LANGUAGES) {
    if (STRINGS[key][l.id] === undefined) console.warn(`Нет перевода "${key}" на ${l.id}`);
  }
}
