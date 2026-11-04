// Whether the phone is on mobile data right now, so banners and episode
// pictures can use a smaller file there and a sharper one on Wi-Fi.
import * as Network from 'expo-network';

let cellular = false;
const update = (state: Network.NetworkState) => {
  cellular = state.type === Network.NetworkStateType.CELLULAR;
};
Network.getNetworkStateAsync().then(update).catch(() => {});
Network.addNetworkStateListener(update);

export const onMobileData = () => cellular;
