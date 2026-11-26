import type { HomeView } from "../../../server/home";
import { type DeviceApiContext, deviceApi } from "./device-api";

// ホームの端末の API（DD-01 M11。DD-02 FN-020、DD-04 `getHome`）。
//   `getHome` GET `/api/app/home`
// 1. 3章 P01 で端末の鍵を確かめる（`deviceApi`）。
// 2. M19 で読み、`openapi.yaml` の `Home` の形で返す。
// 3. 失敗は 500 と MSG-019（読むだけの操作。DD-04 3.4、DD-02 FN-020 手順 8）。

export interface HomeApiContext {
  deviceApi: DeviceApiContext;
  home: HomeView;
}

export function getHome(
  context: HomeApiContext,
): (request: Request) => Promise<Response> {
  const handle = deviceApi(
    context.deviceApi,
    () => Response.json(context.home.getHome()),
    { target: "FN-020" },
  );
  return (request) => handle(request, undefined);
}
