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
  firmware_title:   { en: 'Update the controller', ru: 'Обнови прошивку контроллера', zh: '更新控制器固件', ja: 'ファームウェアを更新' },
  firmware_text:    { en: 'The game needs the latest controller firmware - otherwise new features (like picking the spot with a button) will not work. Plug the controller in with a USB cable, open the link for your device and flash it in the browser (M5Burner, Chrome or Edge). Takes about a minute.',
                      ru: 'Для игры нужна свежая прошивка контроллера - иначе новые функции (например, выбор места кнопкой) не заработают. Подключи контроллер USB-кабелем, открой ссылку для своего устройства и прошей прямо в браузере (M5Burner, Chrome или Edge). Это около минуты.',
                      zh: '游戏需要最新的控制器固件，否则新功能（例如用按键选择位置）无法使用。用 USB 线连接控制器，打开对应设备的链接，直接在浏览器中刷写（M5Burner，Chrome 或 Edge）。大约一分钟。',
                      ja: 'ゲームには最新のファームウェアが必要です。古いままだと新機能（ボタンで場所を選ぶなど）が動きません。USBケーブルでつなぎ、お使いの機種のリンクを開いてブラウザで書き込もう（M5Burner、ChromeかEdge）。約1分です。' },
  btn_flash:        { en: 'Flash {name}', ru: 'Прошить {name}', zh: '刷写 {name}', ja: '{name} に書き込む' },
  btn_firmware_ok:  { en: 'Firmware is up to date - next', ru: 'Прошивка свежая - дальше', zh: '固件已是最新 - 下一步', ja: '更新済み：次へ' },
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

  // ---------- Настройка контроллера (setup.js) ----------
  btn_connect_setup:     { en: 'Connect and set up', ru: 'Подключить и настроить', zh: '连接并设置', ja: '接続して設定' },
  btn_connect_setup_sub: { en: 'Practice the gestures again', ru: 'Пройти жесты заново', zh: '重新练习手势', ja: 'ジェスチャーをもう一度' },
  btn_next:         { en: 'Next', ru: 'Дальше', zh: '下一步', ja: '次へ' },
  btn_skip:         { en: 'Skip', ru: 'Пропустить', zh: '跳过', ja: 'スキップ' },
  btn_skip_setup:   { en: 'Skip setup', ru: 'Пропустить настройку', zh: '跳过设置', ja: '設定をスキップ' },
  btn_play:         { en: 'Play', ru: 'Играть', zh: '开始游戏', ja: 'プレイ' },
  setup_step:       { en: 'Setup: step {n} of {m}', ru: 'Настройка: шаг {n} из {m}', zh: '设置：第 {n} 步，共 {m} 步', ja: '設定：ステップ {n} / {m}' },
  setup_waiting:    { en: 'Waiting for the gesture...', ru: 'Ждём жест...', zh: '等待手势……', ja: 'ジェスチャーを待っています...' },
  setup_got:        { en: 'Got it!', ru: 'Есть!', zh: '成功！', ja: 'OK！' },
  setup_hold:       { en: 'How to hold', ru: 'Как держать', zh: '握持方式', ja: '持ち方' },
  setup_hold_text:  { en: 'Hold the controller like a rod handle: screen towards you, top edge forward.',
                      ru: 'Держи контроллер как рукоять удочки: экраном к себе, верхним краем вперёд.',
                      zh: '像握鱼竿手柄一样握住控制器：屏幕朝向自己，顶端朝前。',
                      ja: '竿のグリップのように持とう：画面を自分に向け、上の端を前に。' },
  setup_hold_note:  { en: 'The video shows just one way to hold it - hold it however is comfortable for you.',
                      ru: 'На видео - лишь один из способов держать контроллер. Держите так, как вам удобно.',
                      zh: '视频只是其中一种握法，怎么舒服怎么握。',
                      ja: '動画は持ち方の一例です。持ちやすい方法で持ってください。' },
  setup_button:     { en: 'Press the button', ru: 'Нажми кнопку', zh: '按下按键', ja: 'ボタンを押す' },
  setup_button_text: { en: 'Press A on StickS3 / StickC Plus2 or any key on Cardputer. This button picks the cast spot.',
                      ru: 'Нажми A на StickS3 или StickC Plus2, любую клавишу на Cardputer. Этой кнопкой выбирается место заброса.',
                      zh: '在 StickS3 / StickC Plus2 上按 A，Cardputer 上按任意键。用这个按键选择抛竿位置。',
                      ja: 'StickS3・StickC Plus2はA、Cardputerは任意のキーを押そう。このボタンで投げる場所を選びます。' },
  setup_doubletap:  { en: 'Double tap', ru: 'Двойной тап', zh: '双击', ja: 'ダブルタップ' },
  setup_doubletap_text: { en: 'Tap the case twice, quickly and lightly, with a fingertip. Not the button!',
                      ru: 'Два быстрых лёгких удара пальцем по корпусу. Не кнопку!',
                      zh: '用指尖快速轻敲外壳两下。不是按按钮！',
                      ja: '指先でケースを素早く軽く2回たたこう。ボタンではありません！' },
  setup_jerk:       { en: 'Jerk', ru: 'Рывок', zh: '猛甩', ja: '振り上げ' },
  setup_jerk_text:  { en: 'A short sharp flick of the wrist upwards, like striking a fish.',
                      ru: 'Короткий резкий взмах кистью вверх, как при подсечке.',
                      zh: '手腕向上短促有力地一甩，就像提竿一样。',
                      ja: 'アワセのように、手首を短く鋭く上に振ろう。' },
  setup_drop:       { en: 'Drop', ru: 'Уронить', zh: '落下', ja: '落とす' },
  setup_drop_text:  { en: 'Drop the controller into your other palm from a few centimetres and catch it.',
                      ru: 'Урони контроллер в другую ладонь с высоты нескольких сантиметров.',
                      zh: '让控制器从几厘米高处落到另一只手掌里。',
                      ja: 'コントローラーを数センチの高さからもう片方の手のひらに落とそう。' },
  setup_laydown:    { en: 'Lay it down', ru: 'Положить', zh: '放下', ja: '置く' },
  setup_laydown_text: { en: 'Put the controller on the table and do not touch it for a few seconds.',
                      ru: 'Положи контроллер на стол и не трогай несколько секунд.',
                      zh: '把控制器放在桌上，几秒钟内不要碰它。',
                      ja: 'コントローラーを机に置いて、数秒間さわらないで。' },
  setup_reel_cw:    { en: 'Spin clockwise', ru: 'Крути по часовой', zh: '顺时针转', ja: '時計回りに回す' },
  setup_reel_cw_text: { en: 'Spin your wrist clockwise, just like in the video. Keep going until the bar is full.',
                      ru: 'Крути кистью по часовой стрелке, как на видео. Крути, пока полоска не заполнится.',
                      zh: '像视频里一样顺时针转动手腕，一直转到进度条填满。',
                      ja: '動画と同じように手首を時計回りに回そう。バーがいっぱいになるまで続けて。' },
  setup_reel_ccw:   { en: 'Now counterclockwise', ru: 'Теперь против часовой', zh: '现在逆时针转', ja: '今度は反時計回り' },
  setup_reel_ccw_text: { en: 'Spin counterclockwise, just like in the video.',
                      ru: 'Крути против часовой стрелки, как на видео.',
                      zh: '像视频里一样逆时针转动。',
                      ja: '動画と同じように反時計回りに回そう。' },
  setup_reel_progress: { en: 'Spinning... {p}%', ru: 'Крутим... {p}%', zh: '转动中……{p}%', ja: '回転中... {p}%' },
  setup_reel_unstable: { en: 'Direction is unclear. Spin steadily in one direction.',
                      ru: 'Направление непонятно. Крути ровно в одну сторону.',
                      zh: '方向不清楚。请稳定地朝一个方向转。',
                      ja: '向きがはっきりしません。一定の向きで回してください。' },
  setup_reel_same:  { en: 'That is clockwise again. Spin counterclockwise.',
                      ru: 'Это снова по часовой. Крути против часовой.',
                      zh: '这还是顺时针。请逆时针转。',
                      ja: 'また時計回りです。反時計回りに回してください。' },
  setup_reel_unsupported: { en: 'This firmware does not report spin direction - update it.',
                      ru: 'Прошивка не сообщает направление вращения - обнови её.',
                      zh: '此固件不支持旋转方向，请更新固件。',
                      ja: 'このファームウェアは回転方向に対応していません。更新してください。' },
  setup_done:       { en: 'All set!', ru: 'Готово!', zh: '设置完成！', ja: '準備OK！' },
  setup_done_text:  { en: 'The controller is ready. Good luck fishing!',
                      ru: 'Контроллер настроен. Ни хвоста, ни чешуи!',
                      zh: '控制器已就绪。祝你满载而归！',
                      ja: 'コントローラーの準備ができました。大漁を祈る！' },

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
  hint_get_ready:   { en: 'GET READY!', ru: 'ПРИГОТОВЬСЯ!', zh: '准备！', ja: '構えろ！' },
  hint_balance:     { en: 'KEEP THE MARKER CENTERED!', ru: 'ДЕРЖИ МАРКЕР ПО ЦЕНТРУ!', zh: '把标记保持在中间！', ja: 'マーカーを真ん中に保て！' },
  balance_cw:       { en: 'SPIN CLOCKWISE >>', ru: 'КРУТИ ПО ЧАСОВОЙ >>', zh: '顺时针转 >>', ja: '時計回りに回せ >>' },
  balance_ccw:      { en: '<< SPIN COUNTERCLOCKWISE', ru: '<< КРУТИ ПРОТИВ ЧАСОВОЙ', zh: '<< 逆时针转', ja: '<< 反時計回りに回せ' },
  hint_bait_x:      { en: 'DOUBLE TAP - BAIT SPOT', ru: 'ДВОЙНОЙ ТАП - МЕСТО ПРИКОРМКИ', zh: '双击 - 选择打窝位置', ja: 'ダブルタップ：撒く場所' },
  hint_aim_x_btn:   { en: 'PRESS BUTTON - PICK A SPOT', ru: 'КНОПКА - ВЫБОР МЕСТА', zh: '按键 - 选择位置', ja: 'ボタン：場所を選ぶ' },
  hint_aim_y_btn:   { en: 'PRESS BUTTON - DISTANCE', ru: 'КНОПКА - ДАЛЬНОСТЬ', zh: '按键 - 选择距离', ja: 'ボタン：距離を選ぶ' },
  hint_bait_x_btn:  { en: 'PRESS BUTTON - BAIT SPOT', ru: 'КНОПКА - МЕСТО ПРИКОРМКИ', zh: '按键 - 选择打窝位置', ja: 'ボタン：撒く場所' },
  hint_bait_y_btn:  { en: 'PRESS BUTTON - BAIT DISTANCE', ru: 'КНОПКА - ДАЛЬНОСТЬ ПРИКОРМКИ', zh: '按键 - 打窝距离', ja: 'ボタン：撒く距離' },
  settings_title:   { en: 'Settings', ru: 'Настройки', zh: '设置', ja: '設定' },
  settings_aim:     { en: 'Pick the cast spot with', ru: 'Чем выбирать место заброса', zh: '选择抛竿位置的方式', ja: '投げる場所の選び方' },
  settings_aim_tap: { en: 'Double tap', ru: 'Двойной тап', zh: '双击', ja: 'ダブルタップ' },
  settings_aim_btn: { en: 'Button', ru: 'Кнопка', zh: '按键', ja: 'ボタン' },
  settings_aim_btn_sub: { en: 'A on StickS3 / StickC Plus2, any key on Cardputer', ru: 'A на StickS3 и StickC Plus2, любая клавиша на Cardputer', zh: 'StickS3 / StickC Plus2 按 A，Cardputer 按任意键', ja: 'StickS3・StickC Plus2はA、Cardputerは任意のキー' },
  settings_aim_note: { en: 'The button needs the latest controller firmware. On the keyboard both Space and A work.', ru: 'Для кнопки нужна свежая прошивка контроллера. С клавиатуры работают и пробел, и A.', zh: '按键需要最新的控制器固件。键盘上空格和 A 都可以。', ja: 'ボタンには最新のファームウェアが必要。キーボードはスペースとAどちらでも可。' },
  btn_resume:       { en: 'Continue', ru: 'Продолжить', zh: '继续', ja: '続ける' },
  btn_resume_setup: { en: 'Continue - redo controller setup', ru: 'Продолжить - заново настроить контроллер', zh: '继续 - 重新设置控制器', ja: '続ける：コントローラーを再設定' },
  hint_bait_y:      { en: 'DOUBLE TAP - BAIT DISTANCE', ru: 'ДВОЙНОЙ ТАП - ДАЛЬНОСТЬ ПРИКОРМКИ', zh: '双击 - 打窝距离', ja: 'ダブルタップ：撒く距離' },
  hint_bait_throw:  { en: 'JERK THE STICK - THROW BAIT!', ru: 'РЫВОК - БРОСЬ ПРИКОРМКУ!', zh: '猛甩手柄 - 抛出鱼饵！', ja: 'スティックを振れ：エサを投げろ！' },
  hint_wood_chop:     { en: 'JERK - CHOP AT THE GREEN MARK!', ru: 'РЫВОК - РУБИ У ЗЕЛЁНОЙ МЕТКИ!', zh: '猛挥 - 在绿色标记处砍！', ja: '振れ！緑の印で切れ！' },
  hint_wood_split:    { en: 'JERK - MARKER IN THE CENTER!', ru: 'РЫВОК, КОГДА МАРКЕР ПО ЦЕНТРУ!', zh: '标记在正中时猛挥！', ja: 'マーカーが真ん中で振れ！' },
  hint_campfire_blow: { en: 'BLOW INTO THE STICK - FAN THE FIRE!', ru: 'ДУЙ В СТИК - РАЗДУЙ КОСТЁР!', zh: '对着手柄吹气 - 把火吹旺！', ja: 'スティックに息を吹け：火をおこせ！' },
  hint_campfire_cook: { en: 'TURN THE SPIT - KEEP IT GREEN!', ru: 'КРУТИ ВЕРТЕЛ - ДЕРЖИ В ЗЕЛЁНОМ!', zh: '转动烤架 - 保持在绿区！', ja: '串を回せ：緑をキープ！' },
  cook_slow:          { en: "TOO SLOW - IT'S BURNING!", ru: 'МЕДЛЕННО - ПОДГОРАЕТ!', zh: '太慢 - 要烤焦了！', ja: '遅い：焦げる！' },
  cook_fast:          { en: 'TOO FAST - STILL RAW!', ru: 'БЫСТРО - НЕ ПРОЖАРИТСЯ!', zh: '太快 - 烤不熟！', ja: '速い：焼けない！' },
  hint_campfire_eat:  { en: 'BON APPETIT!', ru: 'ПРИЯТНОГО АППЕТИТА!', zh: '开动吧！', ja: 'いただきます！' },
  hint_bucket:      { en: 'DROP THE STICK INTO YOUR PALM - INTO THE BUCKET!', ru: 'УРОНИ СТИК В ЛАДОНЬ - В ВЕДРО!', zh: '让手柄落到掌心 - 放进桶里！', ja: 'スティックを手のひらに落とせ：バケツへ！' },
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
  msg_balance_ready: { en: 'GET READY! THE FISH IS SLIPPING OFF!', ru: 'ПРИГОТОВЬСЯ! РЫБКА СРЫВАЕТСЯ!', zh: '准备！鱼要脱钩了！', ja: '構えろ！魚が外れそうだ！' },
  msg_balance_lost: { en: 'THE FISH PULLED AWAY!', ru: 'РЫБА УШЛА В СТОРОНУ!', zh: '鱼挣脱跑掉了！', ja: '魚に走られた！' },
  msg_balance_ok:   { en: 'WELL HELD! KEEP REELING!', ru: 'УДЕРЖАЛ! КРУТИ ДАЛЬШЕ!', zh: '稳住了！继续收线！', ja: 'こらえた！巻き続けろ！' },
  msg_bucket:       { en: 'IN THE BUCKET!', ru: 'В ВЕДРЕ!', zh: '进桶了！', ja: 'バケツに入った！' },
  msg_wood_start:   { en: 'NIGHT FALLS. CHOP SOME WOOD!', ru: 'НОЧЬ. НАРУБИ ДРОВ ДЛЯ КОСТРА!', zh: '夜幕降临，先砍柴！', ja: '夜だ。まず薪を割ろう！' },
  msg_wood_cut:     { en: 'GOT A BLOCK!', ru: 'ЕСТЬ ПОЛЕНО!', zh: '砍下一段！', ja: '一本切れた！' },
  msg_wood_early:   { en: 'TOO EARLY!', ru: 'РАНО!', zh: '太早了！', ja: '早すぎ！' },
  msg_wood_late:    { en: 'MISSED IT! AGAIN', ru: 'ПРОЗЕВАЛ! ЕЩЁ РАЗ', zh: '错过了！再来', ja: '逃した！もう一回' },
  msg_wood_blocks:  { en: 'BLOCKS READY - NOW SPLIT THEM!', ru: 'ПОЛЕНЬЯ ГОТОВЫ - ТЕПЕРЬ КОЛИ!', zh: '木墩好了 - 劈开它们！', ja: '丸太OK - 次は割れ！' },
  msg_wood_split:   { en: 'SPLIT!', ru: 'РАСКОЛОЛ!', zh: '劈开了！', ja: '割れた！' },
  msg_wood_off:     { en: 'OFF CENTER!', ru: 'НЕ ПО ЦЕНТРУ!', zh: '没劈中间！', ja: '真ん中じゃない！' },
  msg_wood_done:    { en: 'FIREWOOD READY! NOW BLOW!', ru: 'ДРОВА ГОТОВЫ! ТЕПЕРЬ ДУЙ!', zh: '柴火好了！现在吹气！', ja: '薪ができた！息を吹け！' },
  msg_cook_burnt:   { en: 'BURNT IT! INTO THE FIRE', ru: 'ПЕРЕЖАРИЛ! РЫБА В КОСТРЕ', zh: '烤焦了！掉进火里', ja: '焦がした！火の中へ' },
  msg_cook_raw:     { en: 'UNDERCOOKED! IT FELL OFF', ru: 'НЕДОЖАРИЛ! РЫБА СЛЕТЕЛА', zh: '没烤熟！鱼掉了', ja: '生焼け！落ちた' },
  msg_cook_next:    { en: 'NEXT FISH FROM THE CATCH!', ru: 'БЕРЁМ РЫБКУ ИЗ УЛОВА!', zh: '从渔获里再拿一条！', ja: '次の魚を取り出そう！' },
  msg_cook_none:    { en: 'NO FISH LEFT - GO HUNGRY', ru: 'УЛОВ КОНЧИЛСЯ - СПАТЬ ГОЛОДНЫМ', zh: '鱼吃完了 - 饿着睡吧', ja: '魚がない：腹ぺこだ' },
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
  result_time:      { en: 'TIME: {t}', ru: 'ВРЕМЯ: {t}', zh: '用时：{t}', ja: 'タイム：{t}' },
  trophies_title:   { en: 'TROPHIES', ru: 'ТРОФЕИ', zh: '战利品', ja: 'トロフィー' },
  trophies_more:    { en: '+{n} MORE', ru: 'ЕЩЁ {n}', zh: '还有 {n} 条', ja: 'ほか {n} 匹' },
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
