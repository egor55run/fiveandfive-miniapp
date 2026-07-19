import { motion, useReducedMotion } from 'framer-motion';
import { Footprints } from 'lucide-react';

function Header() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.header
      className="header"
      initial={reduceMotion ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="header__brand">
        <span className="header__badge" aria-hidden="true">
          <Footprints size={20} strokeWidth={2.2} />
        </span>
        <h1 className="header__title">
          FIVE<span className="header__amp">&amp;</span>FIVE
        </h1>
      </div>

      <p className="header__subtitle">Твои старты в одном приложении</p>
    </motion.header>
  );
}

export default Header;
