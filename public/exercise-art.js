import { motionFrameCountFor, reviewedMotion } from "./exercise-motion-manifest.js";

export const customWorkoutArt = "/assets/custom-workout.webp";
const animatedExercises = new Set(reviewedMotion);

// Short movement cues accompany the matching catalog illustration.
const cues = {
  "bench-press": "双脚踩稳，肩胛收紧，杠铃缓降至胸前。",
  "incline-bench-press": "背贴上斜凳，杠铃缓降至上胸。",
  "dumbbell-bench-press": "双脚踩稳，两侧哑铃同步推起。",
  "dumbbell-fly": "肘部微屈，沿弧线合拢哑铃。",
  "pec-deck": "背贴靠垫，双臂向前合拢，慢慢打开。",
  "cable-crossover": "前后脚站稳，肘微屈，双手在身前合拢。",
  "incline-dumbbell-press": "背贴上斜凳，两手同步推起，缓慢还原。",
  "chest-press": "调节座椅至把手与胸同高，双手平稳前推。",
  "chest-dip": "身体微前倾，屈肘下降，再稳稳撑起。",
  "push-up": "头到脚保持一线，屈肘让胸部靠近地面。",
  "high-cable-fly": "滑轮置低位，肘微屈，双手斜向上合拢。",
  "low-cable-fly": "滑轮置高位，肘微屈，双手斜向下合拢。",
  "pull-up": "从悬垂开始，肘向下拉，身体避免摆动。",
  "assisted-pull-up": "膝盖放稳在辅助垫上，肘向下拉，慢慢还原。",
  "seated-row": "坐稳躯干，手柄拉向腹部，缓慢伸臂。",
  "t-bar-row": "髋部后移，背部稳定，手柄拉向下胸。",
  "barbell-row": "屈髋前倾并稳住背部，杠铃拉向腹部。",
  "reverse-lat-pulldown": "掌心朝自己宽握，肘向下带动横杆到上胸。",
  "dumbbell-row": "一手支撑凳面，另一侧肘部贴近身体向后拉。",
  "chest-supported-row": "胸贴靠垫，双肘向后拉，保持躯干贴垫。",
  "close-pulldown": "双手窄握，肩膀远离耳朵，手柄拉向上胸。",
  "straight-arm-pulldown": "肘微屈并保持角度，横杆沿弧线压向大腿。",
  "deadlift": "屈髋屈膝握杠，杠铃贴近身体，起身时髋膝伸直。",
  "plate-loaded-shoulder-press": "背贴靠垫，手柄从肩旁平稳推至头顶上方。",
  "seated-dumbbell-shoulder-press": "坐稳并收紧躯干，哑铃从肩旁向上推。",
  "dumbbell-lateral-raise": "肘微屈，两臂向两侧抬起，缓慢放下。",
  "reverse-pec-deck": "胸贴靠垫，肘微屈，两臂向外打开。",
  "arnold-press": "从掌心朝内开始，上推时旋至掌心朝前。",
  "front-raise": "躯干保持稳定，哑铃向前抬至肩高附近。",
  "cable-lateral-raise": "从低位拉绳，肘微屈，手臂沿侧方抬起。",
  "reverse-dumbbell-fly": "屈髋前倾并稳住背部，两臂向两侧打开。",
  "face-pull": "绳索拉向脸两侧，双手分开，慢慢还原。",
  "machine-lateral-raise": "前臂贴稳软垫，双肘向侧上方抬起。",
  "barbell-curl": "上臂贴近躯干，屈肘举杠，慢慢放下。",
  "alternating-curl": "左右手交替屈肘，另一侧保持稳定。",
  "hammer-curl": "掌心相对，上臂保持稳定，屈肘举起。",
  "preacher-curl": "上臂贴稳斜垫，屈肘举起，缓慢下放。",
  "cable-curl": "站稳后将低位手柄屈肘拉起，上臂保持稳定。",
  "incline-curl": "背贴上斜凳，手臂自然下垂，从肘部发力。",
  "rope-pushdown": "双肘贴身，下压时将绳索两端向两侧分开。",
  "bar-pushdown": "双肘贴身，直杆平稳压下，缓慢屈肘还原。",
  "overhead-cable-extension": "背对滑轮，肘朝前，沿头顶方向伸直手臂。",
  "lying-triceps-extension": "仰卧平凳，上臂保持稳定，杠铃缓降至额前。",
  "dumbbell-triceps-extension": "双手托住哑铃，上臂靠近头部，屈伸肘部。",
  "close-grip-bench": "双手约肩宽握杠，肘贴近躯干，稳稳推起。",
  "barbell-squat": "脚掌踩稳，膝盖朝脚尖方向，屈髋屈膝下蹲。",
  "dumbbell-rdl": "膝微屈，髋部后移，哑铃沿腿缓慢下放。",
  "leg-press": "背贴靠垫，脚掌贴稳踏板，膝盖随脚尖方向。",
  "leg-extension": "滚垫靠近踝上方，伸直小腿，再缓慢放下。",
  "seated-leg-curl": "坐稳并固定大腿，脚跟向座椅下方屈收。",
  "lying-leg-curl": "俯卧贴稳凳面，脚跟向臀部屈收，再还原。",
  "bulgarian-split-squat": "后脚置于凳面，前脚踩稳，身体向下沉。",
  "dumbbell-lunge": "向前跨步并踩稳，屈膝下沉，再蹬地还原。",
  "hip-thrust": "肩背靠凳，脚踩稳，伸髋抬起杠铃。",
  "standing-calf-raise": "前脚掌踩稳，脚跟平稳抬起，再缓降。",
  "seated-calf-raise": "坐稳并固定大腿，前脚掌踩稳，抬起脚跟。",
  "plank": "肘在肩下，头、躯干和双腿保持一线。",
  "side-plank": "支撑肘在肩下，抬髋，让身体保持一线。",
  "crunch": "下背贴地，肋骨靠近骨盆，缓慢放回。",
  "reverse-crunch": "屈膝收向胸前，轻抬骨盆，再慢慢放下。",
  "hanging-knee-raise": "稳住悬垂姿势，屈膝抬起，避免借摆。",
  "hanging-leg-raise": "悬垂稳住躯干，双腿伸直抬起，慢慢放下。",
  "cable-crunch": "跪姿握绳在头侧，卷曲躯干，让肋骨靠近骨盆。",
  "dead-bug": "下背贴稳地面，对侧手脚缓慢伸展。",
  "russian-twist": "坐稳并轻微后倾，转动胸廓，左右交替。",
  "incline-walk": "身体直立，沿坡面迈小步，保持步频稳定。",
  "hiking": "看清落脚点，坡面缩短步幅，按路况调整节奏。",
  "treadmill-run": "在跑带中部慢跑，步幅自然，双臂放松摆动。",
  "treadmill-walk": "保持跑带平坡，双臂自然摆动，步频稳定。",
  "outdoor-run": "落脚靠近身体下方，双肩放松，保持自然步频。",
  "spin-bike": "调好座高，脚掌踩稳，平顺踩过每一圈。",
  "elliptical": "脚掌贴住踏板，躯干直立，保持连续滑动。",
  "stair-climber": "脚掌踩稳台阶，躯干直立，保持均匀步频。",
  "rowing-machine": "先蹬腿，再带动躯干和手柄，反向顺序还原。",
  "jump-rope": "手腕带动跳绳，双脚轻跳，前脚掌柔和落地。"
};

export function artworkFor(id) {
  if (animatedExercises.has(id)) return `/assets/exercise-motion/${id}/1.webp`;
  return Object.hasOwn(cues, id) ? `/assets/exercises/${id}.webp` : null;
}

export function thumbnailFor(id) {
  return Object.hasOwn(cues, id) ? `/assets/exercise-thumbnails/${id}.webp` : null;
}

export function motionFramesFor(id) {
  if (!animatedExercises.has(id)) return [];
  const count = motionFrameCountFor(id);
  return Array.from({ length: count }, (_, index) => `/assets/exercise-motion/${id}/${index + 1}.webp`);
}

export function cueFor(id) {
  return Object.hasOwn(cues, id) ? cues[id] : null;
}

export const exerciseArtwork = [
  ...Object.keys(cues).map(artworkFor),
  ...reviewedMotion.flatMap(motionFramesFor),
  ...Object.keys(cues).map(thumbnailFor)
];
