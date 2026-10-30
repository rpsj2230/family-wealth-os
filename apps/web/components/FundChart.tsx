import { type SeriesPoint } from '@fwos/core';
import { TrendChart, type TrendSeries } from './TrendChart';

/** What a fund (or all funds) was worth month by month against the money put in; an optional dotted path shows where it leads. */
export function FundChart({
  history,
  projection,
  today,
  caption,
  height = 220,
}: {
  history: SeriesPoint[];
  projection?: SeriesPoint[];
  today: string;
  caption: string;
  height?: number;
}) {
  const series: TrendSeries[] = [
    {
      name: 'Current value',
      colour: 'var(--primary, #4f46e5)',
      area: true,
      points: history.map((p) => ({ date: p.date, value: p.value })),
    },
    {
      name: 'Invested',
      colour: '#64748b',
      points: history
        .filter((p) => p.invested !== null)
        .map((p) => ({ date: p.date, value: p.invested as number })),
    },
  ];
  if (projection && projection.length > 0 && history.length > 0) {
    const last = history[history.length - 1]!;
    series.push({
      name: 'If the pace holds',
      colour: 'var(--ok, #15803d)',
      dashed: true,
      points: [
        { date: last.date, value: last.value },
        ...projection.map((p) => ({ date: p.date, value: p.value })),
      ],
    });
  }
  return (
    <TrendChart
      series={series}
      caption={caption}
      today={today}
      height={height}
      defaultRange="all"
    />
  );
}
