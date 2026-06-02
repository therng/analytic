export function downsampleLTTB<T extends { x: number; y: number }>(data: T[], threshold: number): T[] {
  if (threshold >= data.length || threshold <= 0) return data;
  
  const sampled: T[] = [];
  sampled.push(data[0]); // Always keep the first point

  const bucketSize = (data.length - 2) / (threshold - 2);
  let a = 0;
  let nextA = 0;

  for (let i = 0; i < threshold - 2; i++) {
    let avgX = 0;
    let avgY = 0;
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    let avgRangeEnd = Math.floor((i + 2) * bucketSize) + 1;
    avgRangeEnd = avgRangeEnd > data.length ? data.length : avgRangeEnd;
    const avgRangeLength = avgRangeEnd - avgRangeStart;

    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += data[j].x;
      avgY += data[j].y;
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    const rangeStart = Math.floor(i * bucketSize) + 1;
    let rangeEnd = Math.floor((i + 1) * bucketSize) + 1;
    rangeEnd = rangeEnd > data.length ? data.length : rangeEnd;

    const pointAX = data[a].x;
    const pointAY = data[a].y;

    let maxArea = -1;
    let area = -1;

    for (let j = rangeStart; j < rangeEnd; j++) {
      area = Math.abs((pointAX - avgX) * (data[j].y - pointAY) - (pointAX - data[j].x) * (avgY - pointAY)) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }

    sampled.push(data[nextA]);
    a = nextA;
  }

  sampled.push(data[data.length - 1]); // Always keep the last point
  return sampled;
}
