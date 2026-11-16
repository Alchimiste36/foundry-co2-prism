/** Double pour les régressions d'interface ; les règles Core sont testées séparément sur leur source native. */
export function measureRecordedPath(path) {
  let cost = 0, distance = 0, spaces = 0;
  const waypoints = path.map((point, index) => {
    const sectionCost = index ? point.cost ?? point.terrain?.testCost ?? NaN : 0;
    cost += sectionCost;
    if (index) { distance += point.terrain?.testDistance ?? NaN; spaces += point.terrain?.testSpaces ?? NaN; }
    return { cost, distance, spaces, backward: index ? { cost: sectionCost } : null };
  });
  return { cost, distance, spaces, waypoints };
}
