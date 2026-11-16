export const parts = [
  { id: "chest", name: "胸部", en: "Chest" },
  { id: "back", name: "背部", en: "Back" },
  { id: "shoulders", name: "肩部", en: "Shoulders" },
  { id: "arms", name: "手臂", en: "Arms" },
  { id: "legs", name: "腿部", en: "Legs" },
  { id: "core", name: "核心", en: "Core" },
  { id: "cardio", name: "有氧", en: "Cardio" }
].map((part) => ({ ...part, icon: part.id }));

export const templates = {
  weight: ["weight", "reps", "assistanceKg"],
  body: ["reps"],
  assisted: ["assistanceKg", "reps"],
  time: ["seconds"],
  distance: ["km"],
  cardio: ["seconds", "km"]
};

// The same stable ID is used for recent items and saved records.
const definitions = {
  chest: [
    ["bench-press", "平板杠铃卧推", "Barbell Bench Press", "weight", "bench"],
    ["incline-bench-press", "上斜杠铃卧推", "Incline Barbell Press", "weight", "incline"],
    ["dumbbell-bench-press", "平板哑铃卧推", "Dumbbell Bench Press", "weight", "dumbbell"],
    ["dumbbell-fly", "平板哑铃飞鸟", "Dumbbell Fly", "weight", "fly"],
    ["pec-deck", "蝴蝶机夹胸", "Pec Deck", "weight", "fly"],
    ["cable-crossover", "龙门架绳索夹胸", "Cable Crossover", "weight", "cable"],
    ["incline-dumbbell-press", "上斜哑铃卧推", "Incline Dumbbell Press", "weight", "incline"],
    ["chest-press", "坐姿器械推胸", "Machine Chest Press", "weight", "bench"],
    ["chest-dip", "双杠臂屈伸（胸部侧重）", "Chest Dip", "body", "pull"],
    ["push-up", "标准俯卧撑", "Push-up", "body", "plank"],
    ["high-cable-fly", "上斜绳索夹胸", "Incline Cable Fly", "weight", "cable"],
    ["low-cable-fly", "下斜绳索夹胸", "Decline Cable Fly", "weight", "cable"]
  ],
  back: [
    ["pull-up", "自重引体向上", "Pull-up", "body", "pull"],
    ["assisted-pull-up", "辅助引体向上", "Assisted Pull-up", "assisted", "pull"],
    ["seated-row", "坐姿划船", "Seated Row", "weight", "row"],
    ["t-bar-row", "T杠划船", "T-bar Row", "weight", "row"],
    ["barbell-row", "杠铃划船", "Barbell Row", "weight", "row"],
    ["reverse-lat-pulldown", "反手宽握高位下拉", "Reverse-grip Lat Pulldown", "weight", "cable"],
    ["dumbbell-row", "单臂哑铃划船", "One-arm Dumbbell Row", "weight", "row"],
    ["chest-supported-row", "胸托划船", "Chest-supported Row", "weight", "row"],
    ["close-pulldown", "窄握高位下拉", "Close-grip Lat Pulldown", "weight", "cable"],
    ["straight-arm-pulldown", "直臂绳索下压", "Straight-arm Pulldown", "weight", "cable"],
    ["deadlift", "杠铃硬拉", "Barbell Deadlift", "weight", "squat"]
  ],
  shoulders: [
    ["plate-loaded-shoulder-press", "挂片坐姿肩推", "Plate-loaded Shoulder Press", "weight", "incline"],
    ["seated-dumbbell-shoulder-press", "哑铃坐姿推肩", "Seated Dumbbell Shoulder Press", "weight", "dumbbell"],
    ["dumbbell-lateral-raise", "哑铃侧平举", "Dumbbell Lateral Raise", "weight", "fly"],
    ["reverse-pec-deck", "反向蝴蝶机（后束）", "Reverse Pec Deck", "weight", "fly"],
    ["arnold-press", "阿诺德推举", "Arnold Press", "weight", "dumbbell"],
    ["front-raise", "哑铃前平举", "Dumbbell Front Raise", "weight", "dumbbell"],
    ["cable-lateral-raise", "绳索侧平举", "Cable Lateral Raise", "weight", "cable"],
    ["reverse-dumbbell-fly", "俯身哑铃反向飞鸟", "Bent-over Reverse Fly", "weight", "fly"],
    ["face-pull", "绳索面拉", "Face Pull", "weight", "cable"],
    ["machine-lateral-raise", "器械侧平举", "Machine Lateral Raise", "weight", "fly"]
  ],
  arms: [
    ["barbell-curl", "杠铃弯举", "Barbell Curl", "weight", "arms"],
    ["alternating-curl", "哑铃交替弯举", "Alternating Dumbbell Curl", "weight", "arms"],
    ["hammer-curl", "哑铃锤式弯举", "Hammer Curl", "weight", "arms"],
    ["preacher-curl", "牧师凳弯举", "Preacher Curl", "weight", "arms"],
    ["cable-curl", "绳索弯举", "Cable Curl", "weight", "cable"],
    ["incline-curl", "上斜哑铃弯举", "Incline Dumbbell Curl", "weight", "arms"],
    ["rope-pushdown", "绳索下压", "Rope Pushdown", "weight", "cable"],
    ["bar-pushdown", "直杆下压", "Bar Pushdown", "weight", "cable"],
    ["overhead-cable-extension", "过顶绳索臂屈伸", "Overhead Cable Extension", "weight", "cable"],
    ["lying-triceps-extension", "仰卧杠铃臂屈伸", "Lying Triceps Extension", "weight", "bench"],
    ["dumbbell-triceps-extension", "哑铃颈后臂屈伸", "Dumbbell Triceps Extension", "weight", "arms"],
    ["close-grip-bench", "窄距卧推", "Close-grip Bench Press", "weight", "bench"]
  ],
  legs: [
    ["barbell-squat", "杠铃深蹲", "Barbell Squat", "weight", "squat"],
    ["dumbbell-rdl", "哑铃罗马尼亚硬拉", "Dumbbell Romanian Deadlift", "weight", "squat"],
    ["leg-press", "45°腿举", "45° Leg Press", "weight", "legs"],
    ["leg-extension", "坐姿腿屈伸", "Leg Extension", "weight", "legs"],
    ["seated-leg-curl", "坐姿腿弯举", "Seated Leg Curl", "weight", "legs"],
    ["lying-leg-curl", "俯卧腿弯举", "Lying Leg Curl", "weight", "legs"],
    ["bulgarian-split-squat", "保加利亚分腿蹲", "Bulgarian Split Squat", "weight", "squat"],
    ["dumbbell-lunge", "哑铃弓步蹲", "Dumbbell Lunge", "weight", "squat"],
    ["hip-thrust", "杠铃臀推", "Barbell Hip Thrust", "weight", "bench"],
    ["standing-calf-raise", "站姿提踵", "Standing Calf Raise", "weight", "legs"],
    ["seated-calf-raise", "坐姿提踵", "Seated Calf Raise", "weight", "legs"]
  ],
  core: [
    ["plank", "平板支撑", "Plank", "time", "plank"],
    ["side-plank", "侧平板支撑", "Side Plank", "time", "plank"],
    ["crunch", "标准卷腹", "Crunch", "body", "core"],
    ["reverse-crunch", "反向卷腹", "Reverse Crunch", "body", "core"],
    ["hanging-knee-raise", "悬垂举膝", "Hanging Knee Raise", "body", "pull"],
    ["hanging-leg-raise", "悬垂举腿", "Hanging Leg Raise", "body", "pull"],
    ["cable-crunch", "绳索卷腹", "Cable Crunch", "weight", "cable"],
    ["dead-bug", "死虫式", "Dead Bug", "body", "core"],
    ["russian-twist", "俄罗斯转体", "Russian Twist", "body", "core"]
  ],
  cardio: [
    ["incline-walk", "跑步机坡走", "Treadmill Incline Walk", "cardio", "treadmill"],
    ["hiking", "户外徒步", "Hiking", "cardio", "walk"],
    ["treadmill-run", "跑步机慢跑", "Treadmill Jog", "cardio", "treadmill"],
    ["treadmill-walk", "跑步机快走", "Treadmill Walk", "cardio", "treadmill"],
    ["outdoor-run", "户外跑步", "Outdoor Run", "cardio", "walk"],
    ["spin-bike", "动感单车", "Spin Bike", "cardio", "bike"],
    ["elliptical", "椭圆机", "Elliptical", "cardio", "cardio"],
    ["stair-climber", "登阶机", "Stair Climber", "time", "cardio"],
    ["rowing-machine", "划船机", "Rowing Machine", "cardio", "row"],
    ["jump-rope", "跳绳", "Jump Rope", "time", "cardio"]
  ]
};

export const exercises = Object.entries(definitions).flatMap(([part, items]) =>
  items.map(([id, name, en, template, icon]) => ({ id, part, name, en, template, icon }))
);
