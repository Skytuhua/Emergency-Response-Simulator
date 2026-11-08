import { describe,expect,it } from 'vitest';
import { createHomeLabelsV2,homeLabelV2 } from '../../src/ui/v2/home-labels';

describe('stable display names for a complete run',()=>{
  const homes=[{id:'HH-48113002200-00001'},{id:'HH-48113001502-00001'},{id:'HH-48113002200-03061'}];
  it('distinguishes identical suffixes in different tracts without changing IDs',()=>{
    const before=JSON.stringify(homes),labels=createHomeLabelsV2(homes);
    expect(homeLabelV2(labels,homes[1].id)).toBe('Home 0001');
    expect(homeLabelV2(labels,homes[0].id)).toBe('Home 0002');
    expect(homeLabelV2(labels,homes[2].id)).toBe('Home 0003');
    expect(new Set(labels.values()).size).toBe(3);
    expect(JSON.stringify(homes)).toBe(before);
  });
  it('preserves names after saved-run JSON roundtrip and reordering',()=>{
    const first=createHomeLabelsV2(homes);
    const restored=createHomeLabelsV2(JSON.parse(JSON.stringify([...homes].reverse())));
    expect([...first]).toEqual([...restored]);
    expect(homeLabelV2(first,homes[2].id)).toBe(homeLabelV2(restored,homes[2].id));
  });
  it('uses every home in the supplied universe before any selection or filtering',()=>{
    const labels=createHomeLabelsV2(homes);
    const visible=[homes[0]];
    expect(visible.map(home=>homeLabelV2(labels,home.id))).toEqual(['Home 0002']);
    expect(homeLabelV2(labels,'not-in-this-run')).toBe('Unknown home');
  });
});
