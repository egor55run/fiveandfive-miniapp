import { motion } from 'framer-motion';
import Header from './Header';
import NextRaceCard from './NextRaceCard';

type Props = {
  onRegister: () => void;
};

function HomeScreen({ onRegister }: Props) {
  return (
    <motion.main
      className="home screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header />
      <NextRaceCard onRegister={onRegister} />
    </motion.main>
  );
}

export default HomeScreen;
