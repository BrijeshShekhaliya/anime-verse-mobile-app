// Where the launch animation is, shared with the header it lands in.
// 0: the animated splash is showing (the header's logo stays hidden: the
//    splash's logo is flying to its spot).
// 1: the logo has landed (the header shows its own logo in the same place).
// 2: the wordmark beside it has slid in.
import { makeMutable } from 'react-native-reanimated';

export const splashStage = makeMutable(0);
