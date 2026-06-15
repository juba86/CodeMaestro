export interface Candlestick {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

const sampleData: Candlestick[] = [
    { timestamp: 1, open: 100, high: 110, low: 95, close: 105 },
    { timestamp: 2, open: 105, high: 120, low: 102, close: 118 },
    { timestamp: 3, open: 118, high: 125, low: 110, close: 112 }, // red
    { timestamp: 4, open: 112, high: 115, low: 108, close: 114 },
    { timestamp: 5, open: 114, high: 130, low: 113, close: 128 },
    { timestamp: 6, open: 128, high: 135, low: 125, close: 126 }, // red
    { timestamp: 7, open: 126, high: 140, low: 125, close: 139 },
    { timestamp: 8, open: 139, high: 145, low: 138, close: 144 },
    { timestamp: 9, open: 144, high: 150, low: 142, close: 148 },
    { timestamp: 10, open: 148, high: 155, low: 146, close: 147 }, // red
];

export function loadChartData(): Candlestick[] {
    return sampleData;
}
