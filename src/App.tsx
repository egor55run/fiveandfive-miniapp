import { useState } from 'react';
import './App.css';
import HomeScreen from './components/HomeScreen';
import RegistrationScreen, {
  type Participant,
} from './components/RegistrationScreen';
import RegistrationSuccessScreen from './components/RegistrationSuccessScreen';

type Screen = 'home' | 'registration' | 'success';

function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [participant, setParticipant] = useState<Participant | null>(null);

  const handleSubmit = (data: Participant) => {
    setParticipant(data);
    setCurrentScreen('success');
  };

  if (currentScreen === 'registration') {
    return (
      <RegistrationScreen
        onSubmit={handleSubmit}
        onBack={() => setCurrentScreen('home')}
      />
    );
  }

  if (currentScreen === 'success' && participant) {
    return (
      <RegistrationSuccessScreen
        participant={participant}
        onBackHome={() => setCurrentScreen('home')}
      />
    );
  }

  return <HomeScreen onRegister={() => setCurrentScreen('registration')} />;
}

export default App;
