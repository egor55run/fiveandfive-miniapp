import { motion } from 'framer-motion';
import { LineChart } from 'lucide-react';
import Header from './Header';

// Заглушка. Полноценный экран аналитики (динамика времени, статы, разбор
// по забегам) собирается отдельным этапом — см. backend/_figma/png/04-analytics.png.
function AnalyticsScreen() {
  return (
    <motion.main
      className="screen screen--tabbar"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header />
      <div className="stub">
        <LineChart className="stub__icon" size={40} strokeWidth={1.8} />
        <h2 className="stub__title u-display">Аналитика</h2>
        <p className="stub__text">Скоро здесь появится динамика твоих забегов.</p>
      </div>
    </motion.main>
  );
}

export default AnalyticsScreen;
