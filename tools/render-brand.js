// Renders the Halation logo (Java, 2026-10-22) from its hand-drawn vector source, docs/media/brand/source/halation-mark.svg:
// one continuous white stroke with round caps, turned -18 degrees, in a square viewBox.
//
// Writes:
// - assets/halation-mark.png (512 px): the transparent mark.
// - assets/halation-app-icon.png (256 px): the window and taskbar icon, the mark at 62% on a flat #111111 rounded
//   square (the interface's surface grey) with an 8% white hairline.
// - docs/media/brand/: halation-mark.svg (the source), halation-app-icon.svg, halation-mark-source.png (the mark PNG).
//
// Usage: node tools/render-brand.js   (CHROME and NODE_PATH as needed for Playwright)
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const MARK_PNG = 512;
const ICON_PNG = 256;
// Share of the square the mark spans
const SPAN = 0.62;

const root = path.join(__dirname, "..");
const brand = path.join(root, "docs", "media", "brand");
const markSvg = fs.readFileSync(path.join(brand, "source", "halation-mark.svg"), "utf8").trim() + "\n";

function iconSvg() {
    const [vx, vy, vw, vh] = markSvg.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
    if (vw !== vh) throw new Error("The mark's viewBox must be square");
    const art = markSvg.trim().replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    const scale = +((1024 * SPAN) / vw).toFixed(4);
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">`,
        `<rect width="1024" height="1024" rx="228" fill="#111111"/>`,
        `<rect x="4" y="4" width="1016" height="1016" rx="224" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="8"/>`,
        `<g transform="translate(512 512) scale(${scale}) translate(${-(vx + vw / 2)} ${-(vy + vh / 2)})">${art}</g>`,
        `</svg>`,
        "",
    ].join("\n");
}

async function rasterize(page, svg, size) {
    const base64 = await page.evaluate(
        async ({ svg, size }) => {
            const image = new Image();
            image.src = "data:image/svg+xml;base64," + btoa(svg);
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = size;
            const context = canvas.getContext("2d");
            context.imageSmoothingQuality = "high";
            context.drawImage(image, 0, 0, size, size);
            return canvas.toDataURL("image/png").split(",")[1];
        },
        { svg, size },
    );
    return Buffer.from(base64, "base64");
}

async function main() {
    const icon = iconSvg();
    const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    try {
        const page = await browser.newPage();
        const mark = await rasterize(page, markSvg, MARK_PNG);
        fs.writeFileSync(path.join(root, "assets", "halation-mark.png"), mark);
        fs.writeFileSync(path.join(root, "assets", "halation-app-icon.png"), await rasterize(page, icon, ICON_PNG));
        fs.writeFileSync(path.join(brand, "halation-mark-source.png"), mark);
        fs.writeFileSync(path.join(brand, "halation-mark.svg"), markSvg);
        fs.writeFileSync(path.join(brand, "halation-app-icon.svg"), icon);
    } finally {
        await browser.close();
    }
    console.log("wrote assets/halation-mark.png, assets/halation-app-icon.png and docs/media/brand/");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
