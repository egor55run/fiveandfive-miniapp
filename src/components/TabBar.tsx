import { motion, useReducedMotion } from 'framer-motion';
import { Home, User } from 'lucide-react';

export type TabId = 'home' | 'profile';

type Props = {
  active: TabId;
  onNavigate: (tab: TabId) => void;
};

const TABS = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'profile', label: 'Профиль', icon: User },
] as const;

function TabBar({ active, onNavigate }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.nav
      className="tabbar"
      initial={reduceMotion ? false : { y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            className={`tabbar__tab${isActive ? ' tabbar__tab--active' : ''}`}
            onClick={() => onNavigate(id)}
            aria-current={isActive ? 'page' : undefined}
          >
            {isActive && (
              <motion.span
                className="tabbar__indicator"
                layoutId="tab-indicator"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }
                }
              />
            )}
            <Icon size={22} strokeWidth={2.2} />
            <span className="tabbar__label">{label}</span>
          </button>
        );
      })}
    </motion.nav>
  );
}

export default TabBar;
