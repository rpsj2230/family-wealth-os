import '@/app/(app)/accounts/bankoverview.css';
import '@/app/(app)/deposits/overview.css';
import '@/components/fundviz.css';
import type { HomeModel } from '@/lib/home';
import { homeExplain } from '@/lib/explain-home';
import './home.css';
import { homeLink } from './parts';
import './money.css';
import { ComingUp, Needs } from './Attention';
import { Classes } from './Classes';
import { Goals } from './GoalsRisks';
import { HomeHeadline } from './Headline';
import { Hero } from './Hero';
import { Movement } from './Movement';
import { Position } from './Position';
import { Trend } from './Trend';
import { Where } from './Where';

/**
 * Home, from the most important down, with each figure once: the net worth (its date, how much of it is actual, estimated or a market
 * value), own money and profit, how wealth moved over the period chosen (outside money apart from what was earned), the four kinds of
 * holding (each a link to its own page), what needs a person and what is coming, the trend, where the money is, and the goals. Bank,
 * deposit, fund and liquidity detail lives on their own pages, linked from the cards. The signed-in page and the public sample both
 * draw this from a HomeModel, so they can never look different.
 */
export function HomeView({ m, sample = false }: { m: HomeModel; sample?: boolean }) {
  const styles = m.styles;
  // the "?" explainers, worked out once from the same model the page draws; a link to a page the sample lacks is left out
  const ex = homeExplain(m, (path) => homeLink(path, sample) ?? '');
  const base = sample ? '/demo/dashboard' : '/';
  return (
    <div className="hm">
      <HomeHeadline m={m} sample={sample} ex={ex} />
      <Hero m={m} sample={sample} ex={ex} />
      <Position m={m} sample={sample} />
      <Movement m={m} base={base} range={m.trend.range} sample={sample} ex={ex} />
      <Classes m={m} sample={sample} ex={ex} />
      <div className="hm-grid">
        <Needs m={m} sample={sample} />
        <ComingUp m={m} sample={sample} />
        <Trend m={m} base={base} ex={ex} />
        <Where m={m} styles={styles} sample={sample} ex={ex} />
        <Goals m={m} sample={sample} ex={ex} />
      </div>
    </div>
  );
}
