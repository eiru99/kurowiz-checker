import { createCanvas, loadImage } from 'canvas';
import { getEventNameOcrRegions, debugEventOcrAnalysis } from '../js/event-ocr.js';

const CASES = [
    'test-assets/event-header-valentine2026.png',
    'test-assets/event-header-glorious-memorial.png',
    'test-assets/event-header-kuromaguzero2.png'
];

for (const src of CASES) {
    const image = await loadImage(src);
    const regions = getEventNameOcrRegions(image);
    const debug = debugEventOcrAnalysis(image);
    console.log('\n===', src, '===');
    console.log('ornament:', debug.ornament);
    console.log('abbr:', regions.abbr);
    console.log('title:', regions.title);
}
