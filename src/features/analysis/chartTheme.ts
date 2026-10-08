import type { Theme } from '@antv/g2';

const CATEGORY = [
  '#1783FF',
  '#00C9C9',
  '#F0884D',
  '#D580FF',
  '#7863FF',
  '#60C42D',
  '#BD8F24',
  '#FF80CA',
  '#2491B3',
  '#17C76F',
  '#AABA01',
  '#BC7CFC',
  '#237CBC',
  '#2DE379',
  '#CE8032',
  '#FF7AF4',
  '#545FD3',
  '#AFE410',
  '#D8C608',
  '#FFA1E0',
];

const DARK_TOOLTIP = {
  css: {
    '.g2-tooltip': {
      'font-family': 'sans-serif',
      background: '#1f1f1f',
      opacity: 0.95,
    },
    '.g2-tooltip-title': { color: '#A6A6A6' },
    '.g2-tooltip-list-item-name-label': { color: '#A6A6A6' },
    '.g2-tooltip-list-item-value': { color: '#A6A6A6' },
  },
  crosshairsStroke: '#fff',
  crosshairsLineWidth: 1,
  crosshairsStrokeOpacity: 0.25,
};

export function chartTheme(dark: boolean): Theme {
  const ink = dark ? '#fff' : '#1D2129';
  return {
    color: '#1783FF',
    category10: CATEGORY.slice(0, 10),
    category20: CATEGORY,
    view: {
      viewFill: 'transparent',
      plotFill: 'transparent',
      mainFill: 'transparent',
      contentFill: 'transparent',
    },
    axis: {
      gridLineDash: [3, 4],
      gridLineWidth: 0.5,
      gridStroke: ink,
      gridStrokeOpacity: dark ? 0.25 : 0.1,
      labelFill: ink,
      labelOpacity: 0.45,
      labelFontSize: 12,
      tickStroke: ink,
      tickOpacity: 0.45,
    },
    legendCategory: {
      itemLabelFill: ink,
      itemLabelFillOpacity: 0.9,
      itemValueFill: ink,
      itemValueFillOpacity: 0.65,
      navButtonFill: ink,
      navButtonFillOpacity: 0.65,
      navPageNumFill: ink,
      navPageNumFillOpacity: 0.45,
    },
    label: {
      fill: ink,
      fillOpacity: 0.65,
      connectorStroke: ink,
      connectorStrokeOpacity: 0.45,
    },
    innerLabel: { fill: dark ? '#000' : '#ffffff', fillOpacity: 0.85 },
    slider: {
      selectionFill: '#1783FF',
      selectionFillOpacity: 0.15,
      handleIconStroke: ink,
      handleIconStrokeOpacity: 0.25,
      handleLabelFill: ink,
      handleLabelFillOpacity: 0.45,
    },
    tooltip: dark
      ? DARK_TOOLTIP
      : { css: { '.g2-tooltip': { 'font-family': 'sans-serif' } } },
  };
}
