# Whitebox

**https://whitebox.judy2006969.me**

25 个开发者常用工具，全部在浏览器里跑完。没有后端，没有账号，断网可用。

名字取自「白盒」：所有计算都发生在你能看见的地方，源码在这里，
断了网它照样工作 —— 这三件事互为佐证，缺一个另外两个就不可信。

---

## 里面有什么

| 分类 | 工具 |
|---|---|
| 编码解码 | Base64 · URL · HTML 实体 · Hex · Unicode 转义 · JWT 解码 |
| 生成 | 随机密码 · UUID(v4/v7/ULID) · 哈希 · HMAC · 密钥对 · TOTP · 二维码 |
| 转换 | JSON 格式化 · JSON↔YAML↔TOML · 时间戳 · 进制 · 颜色 · CSV↔JSON |
| 检视 | 正则测试 · 文本对比 · 文本统计 · 命名风格 · Cron · IP/CIDR |

首页搜索框兼做「这坨东西是什么」的识别器：粘贴一段 JWT、时间戳、
CIDR、Base64、UUID、cron 表达式或颜色值，它会在下拉里给出候选解读，
点一下带着内容跳进对应工具。识别不出来就安静地退回普通搜索 ——
**猜错比不猜更糟**，所以宁可少猜。

## 为什么是纯前端

不是因为省服务器钱。是因为这类工具的用户经常要粘贴不该外流的东西：
一个线上 JWT、一段配置、一个准备用的密码。任何"我们不会记录"的承诺，
都不如**根本没有能记录的地方**。

所以：

- 没有后端。部署形态是 Cloudflare Workers 的**静态资源**，没有服务端代码。
- 没有分析脚本、没有 cookie、没有外部字体。整站零第三方请求 ——
  这句话由 `tools/verify-privacy.sh` 每次部署后实测断言，不是自述。
- 敏感工具（密码 / 密钥对 / JWT / HMAC / TOTP）**不写 URL、不写 localStorage**，
  这条在 `types.ts` 里是 `sensitive: true` 一个字段，由运行时统一强制，
  不靠每个工具自己记得。
- 二维码是自己实现的（`src/lib/qr.ts`，ISO/IEC 18004），不引 npm 包 ——
  在生成 WiFi 密码二维码的页面上引第三方 bundle 是自相矛盾的。

唯一的 wasm 依赖是 `hash-wasm`（BLAKE3 / SHA3 / CRC32，浏览器 WebCrypto 没有），
其余全部用 WebCrypto 或自己写。

## 非机密工具的状态会写进 URL

正则、cron、时间戳、diff 这类工具，输入会实时编码进 URL hash，
可以直接把链接发给同事。**机密工具永远不会** —— 白名单不是黑名单，
`sensitive` 的工具连试都不试。

## 开发

```bash
npm install
npm test        # 80 个测试，全部基于 RFC 已知答案而非自证
npm run dev
npm run build
python3 tools/check-contrast.py   # WCAG 对比度门禁，36 组配色
bash tools/verify-privacy.sh      # 线上隐私断言（部署后跑）
```

### 测试的标准

测试全部对照**公开的已知答案向量**，不对照自己的实现：
RFC 4648（Base64/Base32）、RFC 4226 / 6238（HOTP/TOTP）、
RFC 4231（HMAC）、NIST 的哈希向量、WCAG 2.x 对比度公式。

理由很实际：TOTP 那一版最初漏写了 `DataView.setUint32` 的
大端参数，产出的码**看起来完全正常**（6 位数字、每 30 秒变一次），
只是全都是错的。自证式测试会让它一路绿灯上线。

### 对比度是构建门禁，不是建议

`tools/check-contrast.py` 计算 36 组前景/背景配色的 WCAG 对比度，
不达标就退出码非零。它抓到过设计稿里 `--border-strong` 在**两个主题**
都不达标（2.23:1 和 1.92:1，要求 3:1）—— 输入框边框看不见，
是真的会挡人用，不是审美问题。

### 「零第三方请求」差点是假话

首页原本就写着这句，而它一度是**错的**：Cloudflare 免费版对代理（橙云）
域名**默认开启** Web Analytics 自动注入，在边缘改写 HTML 响应体，追加
`static.cloudflareinsights.com/beacon.min.js`。源码里没有它，构建产物里
也没有它，但每个真实访客都会加载它。

第一次没抓到，是因为判据本身是坏的：

```bash
curl -s https://site/ | grep cloudflareinsights          # 0 —— 看起来很干净
curl -s -A 'Mozilla/5.0 ... Chrome/141' https://site/ | grep cloudflareinsights   # 1
```

**Cloudflare 只对浏览器 User-Agent 注入。** 用默认 UA 的 curl 去验证，
等于问了一个永远返回"干净"的问题。

修法是 `public/_headers` 里的 `Cache-Control: ... no-transform` ——
HTTP 标准中禁止代理改写载荷的指令，写在仓库里、随部署走。没有选面板
开关，因为那条路要求先把站点**加进** Web Analytics 产品才能在里面点
Disable（为了退出必须先加入），而且面板设置谁都能点掉。

CSP 是第二道防线，但它自己也差点造成更糟的回归：第一版
`script-src 'self' 'unsafe-inline'` 少了 `'wasm-unsafe-eval'`，
于是 `WebAssembly.compile()` 抛异常，BLAKE3 / SHA3 / CRC32 三个哈希
**静默消失**，页面看起来完全正常。这条现在也在校验脚本里有断言。

## 结构

```
src/
  lib/
    types.ts        工具契约：一个工具是数据，不是页面
    registry.ts     25 个工具的唯一注册表（页面、搜索、sitemap 都从这来）
    runtime.ts      浏览器端外壳：防抖、URL 同步、复制、错误落位
    sniff.ts        粘贴内容识别
    qr.ts           自己实现的 QR 编码器
    json-pos.ts     JSON 报错定位（V8 对短输入不给 position）
    tools/          四类工具的实现
  pages/t/[slug].astro   一个模板生成全部 25 个工具页
```

**布局是推导出来的，不是逐页指定的**：`layoutOf()` 看工具有几个
textarea —— 0 个是「参数在上、输出在下」，1 个是左右分栏，
2 个以上是工作台。所以一致性是结构性的，不靠人记得。

## 已知的取舍

- 文本 diff 是 O(n·m) DP，超过 400 万格会退化成「整块删 + 整块增」，
  不会卡死但也不精确。真要 diff 上万行文件，用 `git diff`。
- Argon2 / bcrypt 没做。它们是**故意慢**的密码哈希，在浏览器里跑
  等于让用户的笔记本风扇替你干活，且容易给人「可以用它存密码」的错觉。
- JWT 只解码不验签。验签需要密钥，而这个站点的前提是不碰你的密钥。
- 字体只用系统栈。想要 JetBrains Mono 的话，本机装了就会自动用上。

## 协作

Issue 提在 https://github.com/s4078486sa/whitebox（公开镜像）。
内部开发与 CI 在自建 forge 上，对外不可达 —— 所以站点上只放 GitHub 链接：
一个别人打不开的「源码」链接，比没有链接更糟，它看起来像开源声明而其实不是。

作者 White Kang。设计意见来自 designer（配色、布局变体规则、
以及「首页别做成万能输入框」这个否决 —— 它是对的）。
