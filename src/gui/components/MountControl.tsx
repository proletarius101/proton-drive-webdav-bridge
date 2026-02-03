import { useState } from 'react';
import { useMountStatus } from '../hooks/useMountStatus.js';

/**
 * Mount control component
 * Manages drive mount/unmount with visual feedback
 */
export function MountControl() {
  const { isMounted, isToggling, toggleMount } = useMountStatus();
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  const handleToggle = async (on: boolean) => {
    try {
      setShowFeedback(true);
      setFeedbackText(on ? 'Mounting drive...' : 'Unmounting drive...');
      await toggleMount(on);
      setFeedbackText(on ? 'Drive mounted' : 'Drive unmounted');
    } catch (err) {
      console.error('Mount toggle failed:', err);
      setFeedbackText('Failed to toggle mount');
    } finally {
      setTimeout(() => setShowFeedback(false), 2000);
    }
  };

  return (
    <div style={{ marginTop: '16px', padding: '12px', borderRadius: '4px', backgroundColor: '#f5f5f5' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          id="mount-toggle"
          type="checkbox"
          checked={isMounted}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={isToggling}
        />
        <span>Mount Drive</span>
      </label>
      {showFeedback && <p style={{ marginTop: '8px', fontSize: '12px' }}>{feedbackText}</p>}
    </div>
  );
}
