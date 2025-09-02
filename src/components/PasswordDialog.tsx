import React, { useState } from 'react';
import { Lock, Eye, EyeOff, Shield, AlertCircle } from 'lucide-react';

interface PasswordDialogProps {
  isOpen: boolean;
  mode: 'setup' | 'unlock';
  onSubmit: (password: string) => void;
  onCancel: () => void;
  error?: string;
}

export const PasswordDialog: React.FC<PasswordDialogProps> = ({
  isOpen,
  mode,
  onSubmit,
  onCancel,
  error,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (mode === 'setup' && password !== confirmPassword) {
      return;
    }
    
    if (password.length < 4) {
      setPasswordError('Password must be at least 4 characters');
      return;
    }

    setPasswordError('');
    onSubmit(password);
    setPassword('');
    setConfirmPassword('');
  };

  const handleCancel = () => {
    setPassword('');
    setConfirmPassword('');
    setPasswordError('');
    onCancel();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center space-x-3">
            <Shield className="text-blue-400" size={24} />
            <h2 className="text-xl font-semibold text-white">
              {mode === 'setup' ? 'Secure Your Connections' : 'Unlock Connections'}
            </h2>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {mode === 'setup' && (
            <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 mb-4">
              <div className="flex items-start space-x-3">
                <Lock className="text-blue-400 mt-0.5" size={16} />
                <div className="text-sm text-blue-300">
                  <p className="font-medium mb-1">Password Protection</p>
                  <p className="text-blue-400">
                    Your connections will be encrypted and stored securely. 
                    You'll need this password to access your connections.
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <AlertCircle className="text-red-400" size={16} />
                <span className="text-red-300 text-sm">{error}</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {mode === 'setup' ? 'Create Password' : 'Enter Password'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 pr-10 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter password"
                minLength={4}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {passwordError && (
              <p className="text-red-400 text-sm mt-1">{passwordError}</p>
            )}
          </div>

          {mode === 'setup' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-10 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Confirm password"
                  minLength={4}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {password && confirmPassword && password !== confirmPassword && (
                <p className="text-red-400 text-sm mt-1">Passwords do not match</p>
              )}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
            >
              {mode === 'setup' ? 'Skip' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={mode === 'setup' && (password !== confirmPassword || password.length < 4)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Lock size={16} />
              <span>{mode === 'setup' ? 'Secure' : 'Unlock'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
