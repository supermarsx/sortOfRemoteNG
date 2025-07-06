import React from 'react';
import { render, screen } from '@testing-library/react';
import GeneralSection from '../src/components/connectionEditor/GeneralSection';
import SSHOptions from '../src/components/connectionEditor/SSHOptions';
import HTTPOptions from '../src/components/connectionEditor/HTTPOptions';
import { Connection } from '../src/types/connection';

describe('ConnectionEditor subcomponents', () => {
  const baseData: Partial<Connection> = {
    name: 'test',
    protocol: 'ssh',
    hostname: 'host',
    port: 22,
    isGroup: false,
  };

  it('shows SSH library selector in GeneralSection when protocol is ssh', () => {
    render(
      <GeneralSection
        formData={{ ...baseData, protocol: 'ssh' }}
        setFormData={() => {}}
        availableGroups={[]}
      />
    );
    expect(screen.getAllByText(/SSH Library/i).length).toBeGreaterThan(0);
  });

  it('shows private key textarea in SSHOptions when authType is key', () => {
    render(
      <SSHOptions
        formData={{ ...baseData, authType: 'key', protocol: 'ssh' }}
        setFormData={() => {}}
      />
    );
    expect(screen.getByPlaceholderText(/BEGIN PRIVATE KEY/)).toBeInTheDocument();
  });

  it('shows basic auth fields in HTTPOptions', () => {
    render(
      <HTTPOptions
        formData={{ ...baseData, protocol: 'http', authType: 'basic' }}
        setFormData={() => {}}
      />
    );
    expect(screen.getByText(/Basic Auth Username/i)).toBeInTheDocument();
  });
});
