export type OverlaySettings = {
  orderVisible: boolean;
  panelBackgroundVisible: boolean;
  panelBackgroundTransparency: number;
  scales: { order: number; hit: number; right: number };
  widths: { order: number; hit: number; right: number };
  position: {
    orderX: number;
    orderY: number;
    hitX: number;
    hitY: number;
    rightX: number;
    rightY: number;
  };
  colors: {
    orderAccent: string;
    hitAccent: string;
    liveAccent: string;
    panelBackground: string;
    primaryText: string;
    orderText: string;
    hitHeaderText: string;
    hitBuyerText: string;
    hitCardText: string;
    liveHeaderText: string;
    liveBuyerText: string;
    liveProductText: string;
    queueBuyerText: string;
    queueProductText: string;
    quantityText: string;
    timerText: string;
  };
};

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  orderVisible: true,
  panelBackgroundVisible: true,
  panelBackgroundTransparency: 0,
  scales: { order: 1, hit: 1, right: 1 },
  widths: { order: 52, hit: 46, right: 63 },
  position: { orderX: 0, orderY: 0, hitX: 0, hitY: 0, rightX: 0, rightY: 0 },
  colors: {
    orderAccent: "#ffffff",
    hitAccent: "#ecba17",
    liveAccent: "#6838ea",
    panelBackground: "#05090f",
    primaryText: "#ffffff",
    orderText: "#ffffff",
    hitHeaderText: "#ffffff",
    hitBuyerText: "#fff06a",
    hitCardText: "#ffffff",
    liveHeaderText: "#ffffff",
    liveBuyerText: "#fff45c",
    liveProductText: "#ffffff",
    queueBuyerText: "#fff06a",
    queueProductText: "#ffffff",
    quantityText: "#e8ff42",
    timerText: "#ffffff",
  },
};
