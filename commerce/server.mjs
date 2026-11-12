import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createCheckout } from './checkout.mjs';
import { stripeProvider, wechatProvider } from './providers.mjs';

const config = process.env;
const publicUrl = new URL(config.ZHIMU_CHECKOUT_ORIGIN);
if (publicUrl.protocol !== 'https:' || publicUrl.href !== publicUrl.origin + '/') throw new Error('Configure a dedicated HTTPS checkout origin.');
const publicOrigin = publicUrl.origin;
const providers = {};
if (config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET) {
  providers.usd = stripeProvider({ key: config.STRIPE_SECRET_KEY, webhookSecret: config.STRIPE_WEBHOOK_SECRET, publicOrigin });
}
const wechat = {
  appid: config.WECHAT_APP_ID, mchid: config.WECHAT_MERCHANT_ID, merchantSerial: config.WECHAT_MERCHANT_SERIAL,
  merchantPath: config.WECHAT_PRIVATE_KEY_FILE, platformSerial: config.WECHAT_PLATFORM_SERIAL,
  platformPath: config.WECHAT_PLATFORM_KEY_FILE, apiKey: config.WECHAT_API_V3_KEY,
};
if (Object.values(wechat).every(Boolean)) {
  providers.cn = wechatProvider({
    ...wechat, publicOrigin, merchantKey: createPrivateKey(await readFile(wechat.merchantPath)),
    platformKey: createPublicKey(await readFile(wechat.platformPath)),
  });
}
if (!Object.keys(providers).length) throw new Error('Configure at least one complete merchant provider.');
const guide = JSON.parse(await readFile(config.ZHIMU_GUIDE_FILE, 'utf8'));
const service = createCheckout({ database: config.ZHIMU_CHECKOUT_DATABASE || 'zhimu-checkout.sqlite', publicOrigin, providers, guide });
const port = Number(config.ZHIMU_CHECKOUT_PORT || 8795);
const server = createServer(service.handle);
server.listen(port, '127.0.0.1', () => console.log('Zhimu checkout is listening locally on port ' + port));
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => server.close(() => service.close()));
