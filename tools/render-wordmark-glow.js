// Renders the halation glow of Home's wordmark (Java, 2026-10-22, tuned in the glow lab) into
// assets/halation-wordmark-glow.png: the light of the letters bleeding warm into the page around them, drawn once so
// the app shows an image beneath the wordmark and runs no blur. The letters themselves are not in it.
//
// The layers, all added to a transparent canvas: a wide haze, the halation (the letters thickened by `spread`, blurred
// by `radius`, partly cut out of the letters), a tight bloom, and a warm fringe just outside the strokes. Radii are CSS
// blur radii at the wordmark's size on Home (600 px wide). The image is MARGIN px larger than the wordmark on each side.
//
// Usage: node tools/render-wordmark-glow.js   (CHROME and NODE_PATH as needed for Playwright)
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const SETTINGS = {
    width: 600,
    height: 68.2,
    fringe: 10,
    halation: { radius: 30, strength: 55, spread: 1, outside: 40, colour: "#ffd4bd" },
    bloom: { radius: 6, strength: 45, colour: "#fff6ea" },
    haze: { strength: 18, radius: 120 },
};
const MARGIN = 260;

const root = path.join(__dirname, "..");
const svg = fs.readFileSync(path.join(root, "assets", "halation-wordmark.svg"), "utf8");

async function main() {
    const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    const page = await browser.newPage();
    const data = await page.evaluate(async ({ svg, s, margin }) => {
        const img = new Image();
        img.src = "data:image/svg+xml;base64," + btoa(svg);
        await img.decode();
        const W = Math.round(s.width + 2 * margin);
        const H = Math.round(s.height + 2 * margin);
        const canvas = () => {
            const c = document.createElement("canvas");
            c.width = W;
            c.height = H;
            return [c, c.getContext("2d")];
        };
        const [out, ox] = canvas();
        const [src, sx] = canvas();
        const [tmp, tx] = canvas();
        const [glow, gx] = canvas();
        sx.drawImage(img, margin, margin, s.width, s.height);
        const layer = (colour, radius, spread, amount, outside) => {
            tx.clearRect(0, 0, W, H);
            tx.filter = spread > 0 ? `blur(${spread}px)` : "none";
            tx.drawImage(src, 0, 0);
            tx.filter = "none";
            if (spread > 0) for (let i = 0; i < 2; i++) tx.drawImage(tmp, 0, 0);
            tx.globalCompositeOperation = "source-in";
            tx.fillStyle = colour;
            tx.fillRect(0, 0, W, H);
            tx.globalCompositeOperation = "source-over";
            gx.clearRect(0, 0, W, H);
            gx.filter = `blur(${radius}px)`;
            gx.drawImage(tmp, 0, 0);
            gx.filter = "none";
            if (outside > 0) {
                gx.globalCompositeOperation = "destination-out";
                gx.globalAlpha = outside / 100;
                gx.drawImage(src, 0, 0);
                gx.globalAlpha = 1;
                gx.globalCompositeOperation = "source-over";
            }
            ox.globalCompositeOperation = "lighter";
            for (let a = amount / 100; a > 0; a -= 1) {
                ox.globalAlpha = Math.min(1, a);
                ox.drawImage(glow, 0, 0);
            }
            ox.globalAlpha = 1;
            ox.globalCompositeOperation = "source-over";
        };
        layer(s.halation.colour, s.haze.radius, 4, s.haze.strength * 0.6, 0);
        layer(s.halation.colour, s.halation.radius, s.halation.spread, s.halation.strength, s.halation.outside);
        layer(s.bloom.colour, s.bloom.radius, 0, s.bloom.strength, 0);
        // The fringe: a hair outside the strokes, in the halation's colour
        gx.clearRect(0, 0, W, H);
        gx.filter = "blur(0.75px)";
        gx.drawImage(src, 0, 0);
        gx.filter = "none";
        gx.globalCompositeOperation = "destination-out";
        gx.drawImage(src, 0, 0);
        gx.globalCompositeOperation = "source-in";
        gx.fillStyle = s.halation.colour;
        gx.fillRect(0, 0, W, H);
        gx.globalCompositeOperation = "source-over";
        ox.globalCompositeOperation = "lighter";
        ox.globalAlpha = s.fringe / 100;
        ox.drawImage(glow, 0, 0);
        return out.toDataURL("image/png");
    }, { svg, s: SETTINGS, margin: MARGIN });
    await browser.close();
    const file = path.join(root, "assets", "halation-wordmark-glow.png");
    fs.writeFileSync(file, Buffer.from(data.split(",")[1], "base64"));
    console.log(`wrote ${file}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
