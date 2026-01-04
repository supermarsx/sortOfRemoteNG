import React, { useState, useEffect, useCallback } from 'react';
import { Database, Plus, Lock, Trash2, Edit, Eye, EyeOff, Download, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConnectionCollection } from '../types/connection';
import { CollectionManager } from '../utils/collectionManager';

interface CollectionSelectorProps {
  isOpen: boolean;
  onCollectionSelect: (collectionId: string, password?: string) => void;
  onClose: () => void;
}

export const CollectionSelector: React.FC<CollectionSelectorProps> = ({
  isOpen,
  onCollectionSelect,
  onClose,
}) => {
  const { t } = useTranslation();
  const [collections, setCollections] = useState<ConnectionCollection[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<ConnectionCollection | null>(null);
  const [newCollection, setNewCollection] = useState({
    name: '',
    description: '',
    isEncrypted: false,
    password: '',
    confirmPassword: '',
  });
  const [editingCollection, setEditingCollection] = useState<ConnectionCollection | null>(null);
  const [editPassword, setEditPassword] = useState({
    current: '',
    next: '',
    confirm: '',
    enableEncryption: false,
  });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [importCollectionName, setImportCollectionName] = useState('');
  const [encryptImport, setEncryptImport] = useState(false);
  const [importEncryptPassword, setImportEncryptPassword] = useState('');
  const [importEncryptConfirmPassword, setImportEncryptConfirmPassword] = useState('');
  const [exportingCollection, setExportingCollection] = useState<ConnectionCollection | null>(null);
  const [includePasswords, setIncludePasswords] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [collectionPassword, setCollectionPassword] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const collectionManager = CollectionManager.getInstance();

  const loadCollections = useCallback(async () => {
    const allCollections = await collectionManager.getAllCollections();
    setCollections(allCollections);
  }, [collectionManager]);

  useEffect(() => {
    if (isOpen) {
      loadCollections();
    }
  }, [isOpen, loadCollections]);

  const handleCreateCollection = async () => {
    if (!newCollection.name.trim()) {
      setError('Collection name is required');
      return;
    }

    if (newCollection.isEncrypted) {
      if (!newCollection.password) {
        setError('Password is required for encrypted collections');
        return;
      }
      if (newCollection.password !== newCollection.confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (newCollection.password.length < 4) {
        setError('Password must be at least 4 characters');
        return;
      }
    }

    try {
      const collection = await collectionManager.createCollection(
        newCollection.name,
        newCollection.description,
        newCollection.isEncrypted,
        newCollection.password || undefined
      );

      setCollections([...collections, collection]);
      setShowCreateForm(false);
      setNewCollection({
        name: '',
        description: '',
        isEncrypted: false,
        password: '',
        confirmPassword: '',
      });
      setError('');

      // Auto-select the new collection
      onCollectionSelect(collection.id, newCollection.password || undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create collection');
    }
  };

  const handleImportCollection = async () => {
    if (!importFile) {
      setError('Select a collection file to import');
      return;
    }

    if (encryptImport) {
      if (!importEncryptPassword) {
        setError('Password is required to encrypt the imported collection');
        return;
      }
      if (importEncryptPassword !== importEncryptConfirmPassword) {
        setError('Encryption passwords do not match');
        return;
      }
    }

    try {
      const content = await importFile.text();
      const collection = await collectionManager.importCollection(content, {
        importPassword: importPassword || undefined,
        collectionName: importCollectionName.trim() || undefined,
        encryptPassword: encryptImport ? importEncryptPassword : undefined,
      });

      setCollections([...collections, collection]);
      setShowImportForm(false);
      setImportFile(null);
      setImportPassword('');
      setImportCollectionName('');
      setEncryptImport(false);
      setImportEncryptPassword('');
      setImportEncryptConfirmPassword('');
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to import collection');
    }
  };

  const handleExportCollection = (collection: ConnectionCollection) => {
    setExportingCollection(collection);
    setIncludePasswords(false);
    setExportPassword('');
    setCollectionPassword('');
    setError('');
  };

  const handleExportDownload = async () => {
    if (!exportingCollection) return;

    try {
      const content = await collectionManager.exportCollection(
        exportingCollection.id,
        includePasswords,
        exportPassword || undefined,
        collectionPassword || undefined,
      );
      const filename = collectionManager.generateExportFilename();
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportingCollection(null);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to export collection');
    }
  };

  const handleSelectCollection = (collection: ConnectionCollection) => {
    if (collection.isEncrypted) {
      setSelectedCollection(collection);
      setShowPasswordDialog(true);
      setPassword('');
      setError('');
    } else {
      onCollectionSelect(collection.id);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!selectedCollection) return;

    try {
      onCollectionSelect(selectedCollection.id, password);
      setShowPasswordDialog(false);
      setPassword('');
      setError('');
    } catch (error) {
      setError('Invalid password');
    }
  };

  const handleDeleteCollection = async (collection: ConnectionCollection) => {
    if (confirm(`Are you sure you want to delete the collection "${collection.name}"? This action cannot be undone.`)) {
      try {
        await collectionManager.deleteCollection(collection.id);
        setCollections(collections.filter(c => c.id !== collection.id));
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to delete collection');
      }
    }
  };

  const handleEditCollection = (collection: ConnectionCollection) => {
    setEditingCollection({ ...collection });
    setEditPassword({
      current: '',
      next: '',
      confirm: '',
      enableEncryption: collection.isEncrypted,
    });
    setError('');
  };

  const handleUpdateCollection = async () => {
    if (!editingCollection) return;
    if (!editingCollection.name.trim()) {
      setError('Collection name is required');
      return;
    }

    const wantsEncryption = editPassword.enableEncryption;
    const wantsPasswordChange = Boolean(editPassword.next);

    if (wantsEncryption) {
      if (!editingCollection.isEncrypted && !wantsPasswordChange) {
        setError('Password is required to encrypt this collection');
        return;
      }
      if (wantsPasswordChange) {
        if (editPassword.next !== editPassword.confirm) {
          setError('New passwords do not match');
          return;
        }
        if (editPassword.next.length < 4) {
          setError('Password must be at least 4 characters');
          return;
        }
        if (editingCollection.isEncrypted && !editPassword.current) {
          setError('Current password is required');
          return;
        }
      }
    } else if (editingCollection.isEncrypted && !editPassword.current) {
      setError('Current password is required to remove encryption');
      return;
    }

    try {
      let updatedCollection = { ...editingCollection, isEncrypted: wantsEncryption };

      if (editingCollection.isEncrypted && !wantsEncryption) {
        await collectionManager.removePasswordFromCollection(
          editingCollection.id,
          editPassword.current,
        );
        updatedCollection = { ...updatedCollection, isEncrypted: false };
      }

      if (wantsEncryption && wantsPasswordChange) {
        await collectionManager.changeCollectionPassword(
          editingCollection.id,
          editingCollection.isEncrypted ? editPassword.current : undefined,
          editPassword.next,
        );
        updatedCollection = { ...updatedCollection, isEncrypted: true };
      }

      await collectionManager.updateCollection(updatedCollection);
      setCollections(collections.map(c => c.id === editingCollection.id ? updatedCollection : c));
      setEditingCollection(null);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update collection');
    }
  };

  // Handle ESC key to close dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden relative">
        <div className="relative h-16 border-b border-gray-700">
          <h2 className="absolute left-6 top-4 text-xl font-semibold text-white flex items-center space-x-2">
            <Database size={20} className="text-blue-400" />
            <span>Connection Collections</span>
          </h2>
          <div className="absolute right-4 top-3 flex items-center space-x-2">
            <button
              onClick={() => setShowImportForm(true)}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Upload size={14} />
              <span>Import</span>
            </button>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Plus size={14} />
              <span>New</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* Create Collection Form */}
          {showCreateForm && (
            <div className="bg-gray-700 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-medium text-white mb-4">Create New Collection</h3>
              
              {error && (
                <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Collection Name *
                  </label>
                  <input
                    type="text"
                    value={newCollection.name}
                    onChange={(e) => setNewCollection({ ...newCollection, name: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                    placeholder="My Connections"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Description
                  </label>
                  <textarea
                    value={newCollection.description}
                    onChange={(e) => setNewCollection({ ...newCollection, description: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white resize-none"
                    rows={3}
                    placeholder="Optional description"
                  />
                </div>

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={newCollection.isEncrypted}
                    onChange={(e) => setNewCollection({ ...newCollection, isEncrypted: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-gray-300">Encrypt this collection</span>
                </label>

                {newCollection.isEncrypted && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Password *
                      </label>
                      <input
                        type="password"
                        value={newCollection.password}
                        onChange={(e) => setNewCollection({ ...newCollection, password: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                        placeholder="Enter password"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Confirm Password *
                      </label>
                      <input
                        type="password"
                        value={newCollection.confirmPassword}
                        onChange={(e) => setNewCollection({ ...newCollection, confirmPassword: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                        placeholder="Confirm password"
                      />
                    </div>
                  </>
                )}

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowCreateForm(false);
                      setError('');
                    }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateCollection}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                  >
                    Create Collection
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Password Dialog */}
          {showPasswordDialog && selectedCollection && (
            <div className="bg-gray-700 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-medium text-white mb-4">
                Unlock Collection: {selectedCollection.name}
              </h3>
              
              {error && (
                <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                      className="w-full px-3 py-2 pr-10 bg-gray-600 border border-gray-500 rounded-md text-white"
                      placeholder="Enter collection password"
                      autoFocus
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowPasswordDialog(false);
                      setError('');
                    }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePasswordSubmit}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                  >
                    Unlock
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Export Collection Form */}
          {exportingCollection && (
            <div className="bg-gray-700 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-medium text-white mb-4">
                Export Collection: {exportingCollection.name}
              </h3>

              {error && (
                <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                {exportingCollection.isEncrypted && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Collection Password
                    </label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={collectionPassword}
                      onChange={(e) => setCollectionPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                      placeholder="Password"
                    />
                  </div>
                )}

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={includePasswords}
                    onChange={(e) => setIncludePasswords(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-gray-300">Include passwords</span>
                </label>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Export Password (optional)
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                    placeholder="Encrypt export"
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setExportingCollection(null);
                      setError('');
                    }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExportDownload}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
                  >
                    <Download size={14} />
                    <span>Export</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Import Collection Form */}
          {showImportForm && (
            <div className="bg-gray-700 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-medium text-white mb-4">Import Collection</h3>

              {error && (
                <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Collection File *
                  </label>
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Collection Name (optional)
                  </label>
                  <input
                    type="text"
                    value={importCollectionName}
                    onChange={(e) => setImportCollectionName(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                    placeholder="Leave blank to use the export name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Import Password (if encrypted)
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                    placeholder="Password"
                  />
                </div>

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={encryptImport}
                    onChange={(e) => setEncryptImport(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-gray-300">Encrypt imported collection</span>
                </label>

                {encryptImport && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        New Password
                      </label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={importEncryptPassword}
                        onChange={(e) => setImportEncryptPassword(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                        placeholder="New password"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Confirm Password
                      </label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={importEncryptConfirmPassword}
                        onChange={(e) => setImportEncryptConfirmPassword(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                        placeholder="Confirm password"
                      />
                    </div>
                  </>
                )}

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowImportForm(false);
                      setError('');
                    }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleImportCollection}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
                  >
                    <Upload size={14} />
                    <span>Import</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Collection Form */}
          {editingCollection && (
            <div className="bg-gray-700 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-medium text-white mb-4">Edit Collection</h3>

              {error && (
                <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Collection Name *
                  </label>
                  <input
                    type="text"
                    value={editingCollection.name}
                    onChange={(e) => setEditingCollection({ ...editingCollection, name: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Description
                  </label>
                  <textarea
                    value={editingCollection.description || ''}
                    onChange={(e) => setEditingCollection({ ...editingCollection, description: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white resize-none"
                    rows={3}
                  />
                </div>

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={editPassword.enableEncryption}
                    onChange={(e) =>
                      setEditPassword((prev) => ({
                        ...prev,
                        enableEncryption: e.target.checked,
                      }))
                    }
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-gray-300">Encrypt this collection</span>
                </label>

                {(editingCollection.isEncrypted || editPassword.enableEncryption) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Current Password
                      </label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={editPassword.current}
                        onChange={(e) =>
                          setEditPassword((prev) => ({
                            ...prev,
                            current: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                        placeholder="Current password"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        New Password
                      </label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={editPassword.next}
                        onChange={(e) =>
                          setEditPassword((prev) => ({
                            ...prev,
                            next: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                        placeholder="New password"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Confirm Password
                      </label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={editPassword.confirm}
                        onChange={(e) =>
                          setEditPassword((prev) => ({
                            ...prev,
                            confirm: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                        placeholder="Confirm password"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="w-full px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors flex items-center justify-center space-x-2"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        <span>{showPassword ? 'Hide' : 'Show'}</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => { setEditingCollection(null); setError(''); }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateCollection}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                  >
                    Update
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Collections List */}
          <div className="space-y-3">
            {collections.length === 0 ? (
              <div className="text-center py-12">
                <Database size={48} className="mx-auto text-gray-500 mb-4" />
                <p className="text-gray-400 mb-2">No collections found</p>
                <p className="text-gray-500 text-sm">Create your first connection collection to get started</p>
              </div>
            ) : (
              collections.map(collection => (
                <div
                  key={collection.id}
                  className="bg-gray-700 rounded-lg p-4 hover:bg-gray-600 transition-colors cursor-pointer"
                  onClick={() => handleSelectCollection(collection)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center space-x-2">
                        <Database size={20} className="text-blue-400" />
                        {collection.isEncrypted && (
                          <Lock size={16} className="text-yellow-400" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-white font-medium">{collection.name}</h4>
                        {collection.description && (
                          <p className="text-gray-400 text-sm">{collection.description}</p>
                        )}
                        <p className="text-gray-500 text-xs">
                          Last accessed: {collection.lastAccessed.toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExportCollection(collection);
                        }}
                        className="p-2 hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-white"
                        title="Export"
                      >
                        <Download size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditCollection(collection);
                        }}
                        className="p-2 hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-white"
                        title="Edit"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCollection(collection);
                        }}
                        className="p-2 hover:bg-gray-600 rounded transition-colors text-red-400 hover:text-red-300"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
