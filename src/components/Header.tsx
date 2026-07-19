import { motion } from 'framer-motion';
import { Footprints } from 'lucide-react';

function Header() {
  return (
    <motion.header
      className="header"
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="header__brand">
        <span className="header__badge" aria-hidden="true">
          <Footprints size={22} strokeWidth={2.5} />
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
