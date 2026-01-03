import React from 'react';
import { Connection } from '../../types/connection';

interface CloudProviderOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const CloudProviderOptions: React.FC<CloudProviderOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const updateCloudProvider = (updates: Partial<NonNullable<Connection['cloudProvider']>>) => {
    setFormData(prev => ({
      ...prev,
      cloudProvider: {
        ...prev.cloudProvider,
        ...updates,
      },
    }));
  };

  if (!['gcp', 'azure', 'ibm-csp', 'digital-ocean'].includes(formData.protocol || '')) {
    return null;
  }

  const provider = formData.protocol;
  const cloudProvider = formData.cloudProvider || {};

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-gray-300">
        {provider === 'gcp' && 'Google Cloud Platform'}
        {provider === 'azure' && 'Microsoft Azure'}
        {provider === 'ibm-csp' && 'IBM Cloud'}
        {provider === 'digital-ocean' && 'Digital Ocean'}
        {' Configuration'}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {provider === 'gcp' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Project ID</label>
              <input
                type="text"
                value={cloudProvider.projectId || ''}
                onChange={(e) => updateCloudProvider({ projectId: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="my-gcp-project"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Zone</label>
              <input
                type="text"
                value={cloudProvider.zone || ''}
                onChange={(e) => updateCloudProvider({ zone: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="us-central1-a"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Service Account Key (JSON)</label>
              <textarea
                value={cloudProvider.serviceAccountKey || ''}
                onChange={(e) => updateCloudProvider({ serviceAccountKey: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={4}
                placeholder="Paste your GCP service account key JSON here"
              />
            </div>
          </>
        )}

        {provider === 'azure' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Subscription ID</label>
              <input
                type="text"
                value={cloudProvider.subscriptionId || ''}
                onChange={(e) => updateCloudProvider({ subscriptionId: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Resource Group</label>
              <input
                type="text"
                value={cloudProvider.resourceGroup || ''}
                onChange={(e) => updateCloudProvider({ resourceGroup: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="my-resource-group"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Client ID</label>
              <input
                type="text"
                value={cloudProvider.clientId || ''}
                onChange={(e) => updateCloudProvider({ clientId: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Client Secret</label>
              <input
                type="password"
                value={cloudProvider.clientSecret || ''}
                onChange={(e) => updateCloudProvider({ clientSecret: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Your client secret"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Tenant ID</label>
              <input
                type="text"
                value={cloudProvider.tenantId || ''}
                onChange={(e) => updateCloudProvider({ tenantId: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
          </>
        )}

        {(provider === 'ibm-csp' || provider === 'digital-ocean') && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">API Key</label>
              <input
                type="password"
                value={cloudProvider.apiKey || ''}
                onChange={(e) => updateCloudProvider({ apiKey: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Your API key"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Region</label>
              <input
                type="text"
                value={cloudProvider.region || ''}
                onChange={(e) => updateCloudProvider({ region: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={provider === 'ibm-csp' ? 'us-south' : 'nyc1'}
              />
            </div>
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Instance ID/Name</label>
          <input
            type="text"
            value={cloudProvider.instanceId || cloudProvider.instanceName || ''}
            onChange={(e) => updateCloudProvider({
              instanceId: e.target.value,
              instanceName: e.target.value
            })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Instance ID or name"
          />
        </div>
      </div>
    </div>
  );
};

export default CloudProviderOptions;