import React, { useState, useEffect } from 'react';
import { Database, Plus, Lock, Unlock, Trash2, Edit, Eye, EyeOff } from 'lucide-react';
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
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<ConnectionCollection | null>(null);
  const [newCollection, setNewCollection] = useState({
    name: '',
    description: '',
    isEncrypted: false,
    password: '',
    confirmPassword: '',
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const collectionManager = CollectionManager.getInstance();

  useEffect(() => {
    if (isOpen) {
      loadCollections();
    }
  }, [isOpen]);

  const loadCollections = () => {
    const allCollections = collectionManager.getAllCollections();
    setCollections(allCollections);
  };

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

  const handlePasswordSubmit = () => {
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white flex items-center space-x-2">
            <Database size={20} className="text-blue-400" />
            <span>Connection Collections</span>
          </h2>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
          >
            <Plus size={14} />
            <span>New Collection</span>
          </button>
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
                          // TODO: Implement edit functionality
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