import '@/app/(app)/accounts/bankoverview.css';
import '@/app/(app)/deposits/overview.css';
import '@/components/fundviz.css';
import type { HomeModel } from '@/lib/home';
import { homeExplain } from '@/lib/explain-home';
import './home.css';
import { homeLink } from './parts';
import './money.css';
import { ComingUp, Changed, Needs } from './Attention';
import { Banks, Deposits } from './Banks';
import { Classes } from './Classes';
import { Funds } from './Funds';
import { Goals, Risks } from './GoalsRisks';
import { Hero } from './Hero';
import { Liquidity } from './Liquidity';
import { Periods } from './Periods';
import { Trend } from './Trend';
import { Where } from './Where';

/**
 * Home: the net worth with what changed and how far it can be trusted, the money put in and earned, the four kinds of holding and
 * the profit of each in every period, then what needs a person and what is coming, then the trend,
 * where the money is, how fast it can be reached, the banks, deposits and funds, goals and what to watch. The signed-in page and the
 * public sample both draw this from a HomeModel, so they can never look different.
 */
export function HomeView({ m, sample = false }: { m: HomeModel; sample?: boolean }) {
  const styles = m.styles;
  // the "?" explainers, worked out once from the same model the page draws; a link to a page the sample lacks is left out
  const ex = homeExplain(m, (path) => homeLink(path, sample) ?? '');
  return (
    <div className="hm">
      <Hero m={m} sample={sample} ex={ex} />
      <Classes m={m} sample={sample} ex={ex} />
      <Periods m={m} sample={sample} ex={ex} />
      <div className="hm-grid">
        <Needs m={m} sample={sample} />
        <ComingUp m={m} sample={sample} />
        <Changed m={m} styles={styles} ex={ex} />
        <Trend m={m} base={sample ? '/demo/dashboard' : '/'} ex={ex} />
        <Where m={m} styles={styles} sample={sample} ex={ex} />
        <Liquidity m={m} sample={sample} ex={ex} />
        <Banks m={m} sample={sample} ex={ex} />
        <Deposits m={m} sample={sample} ex={ex} />
        <Funds m={m} styles={styles} sample={sample} ex={ex} />
        <Goals m={m} sample={sample} ex={ex} />
        <Risks m={m} sample={sample} ex={ex} />
      </div>
    </div>
  );
}
