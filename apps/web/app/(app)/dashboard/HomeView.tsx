import '@/app/(app)/accounts/bankoverview.css';
import '@/app/(app)/deposits/overview.css';
import '@/components/fundviz.css';
import type { HomeModel } from '@/lib/home';
import './home.css';
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
  return (
    <div className="hm">
      <Hero m={m} sample={sample} />
      <Classes m={m} sample={sample} />
      <Periods m={m} sample={sample} />
      <div className="hm-grid">
        <Needs m={m} sample={sample} />
        <ComingUp m={m} sample={sample} />
        <Changed m={m} styles={styles} />
        <Trend m={m} base={sample ? '/demo/dashboard' : '/'} />
        <Where m={m} styles={styles} sample={sample} />
        <Liquidity m={m} sample={sample} />
        <Banks m={m} sample={sample} />
        <Deposits m={m} sample={sample} />
        <Funds m={m} styles={styles} sample={sample} />
        <Goals m={m} sample={sample} />
        <Risks m={m} sample={sample} />
      </div>
    </div>
  );
}
