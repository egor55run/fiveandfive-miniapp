import { useState } from 'react';
import './App.css';
import HomeScreen from './components/HomeScreen';
import ProfileScreen from './components/ProfileScreen';
import RegistrationScreen, {
  type Participant,
} from './components/RegistrationScreen';
import RegistrationSuccessScreen from './components/RegistrationSuccessScreen';
import TabBar from './components/TabBar';

type Screen = 'home' | 'profile' | 'registration' | 'success';

function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [participant, setParticipant] = useState<Participant | null>(null);

  const handleSubmit = (data: Participant) => {
    setParticipant(data);
    setCurrentScreen('success');
  };

  // Флоу регистрации — со своей кнопкой "Назад", без таб-бара.
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

  // Основные экраны — с нижним таб-баром.
  return (
    <>
      {currentScreen === 'profile' ? (
        <ProfileScreen
          participant={participant}
          onViewRaces={() => setCurrentScreen('home')}
        />
      ) : (
        <HomeScreen onRegister={() => setCurrentScreen('registration')} />
      )}

      <TabBar
        active={currentScreen === 'profile' ? 'profile' : 'home'}
        onNavigate={(tab) => setCurrentScreen(tab)}
      />
    </>
  );
}

export default App;
