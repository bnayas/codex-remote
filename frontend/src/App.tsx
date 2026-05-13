import React, { useState } from 'react';
import { Project, Session } from './types';
import { isConfigured, clearCredentials } from './api';
import { SetupScreen } from './screens/SetupScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { ProjectScreen } from './screens/ProjectScreen';
import { SessionScreen } from './screens/SessionScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import './app.css';

// ─── Root App ──────────────────────────────────────────────────────────────

type Screen =
  | { name: 'setup' }
  | { name: 'projects' }
  | { name: 'project'; project: Project }
  | { name: 'session'; session: Session };

export default function App() {
  const [screen, setScreen] = useState<Screen>(
    isConfigured() ? { name: 'projects' } : { name: 'setup' }
  );

  function openSession(session: Session) {
    setScreen({ name: 'session', session });
  }

  function openProject(project: Project) {
    setScreen({ name: 'project', project });
  }

  function goProjects() {
    setScreen({ name: 'projects' });
  }

  let content: React.ReactNode = null;

  if (screen.name === 'setup') {
    content = <SetupScreen onConnect={() => setScreen({ name: 'projects' })} />;
  } else if (screen.name === 'projects') {
    content = (
      <ProjectsScreen
        onSelectProject={openProject}
        onSelectSession={openSession}
        onDisconnect={() => { clearCredentials(); setScreen({ name: 'setup' }); }}
      />
    );
  } else if (screen.name === 'project') {
    content = (
      <ProjectScreen
        project={screen.project}
        onBack={goProjects}
        onOpenSession={openSession}
      />
    );
  } else if (screen.name === 'session') {
    content = (
      <SessionScreen
        session={screen.session}
        onBack={goProjects}
      />
    );
  }

  return (
    <ErrorBoundary fallbackMessage="The app encountered an error. Please refresh.">
      {content}
      <ToastContainer />
    </ErrorBoundary>
  );
}
