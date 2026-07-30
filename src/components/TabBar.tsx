import { motion, useReducedMotion } from 'framer-motion';
import { BarChart3, Home, User } from 'lucide-react';

export type TabId = 'analytics' | 'home' | 'profile';

type Props = {
  active: TabId;
  onNavigate: (tab: TabId) => void;
};

const TABS = [
  { id: 'analytics', label: 'analytics', icon: BarChart3 },
  { id: 'home', label: 'home', icon: Home },
  { id: 'profile', label: 'profile', icon: User },
] as const;

function TabBar({ active, onNavigate }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <nav className="tabbar">
      {TABS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <motion.button
            key={id}
            type="button"
            layout={!reduceMotion}
            className={`tabbar__tab${isActive ? ' tabbar__tab--active' : ''}`}
            onClick={() => onNavigate(id)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={label}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
          >
            <Icon size={24} strokeWidth={2.2} />
            {isActive && <span className="tabbar__label">{label}</span>}
          </motion.button>
        );
      })}
    </nav>
  );
}

export default TabBar;
