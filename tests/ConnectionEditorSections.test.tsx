import React from 'react';
import { render, screen } from '@testing-library/react';
import GeneralSection from '../src/components/connectionEditor/GeneralSection';
import SSHOptions from '../src/components/connectionEditor/SSHOptions';
import HTTPOptions from '../src/components/connectionEditor/HTTPOptions';
import { Connection, Protocol } from '../src/types/connection';

describe('ConnectionEditor subcomponents', () => {
  const baseData: Partial<Connection> = {
    name: 'test',
    protocol: Protocol.SSH,
    hostname: 'host',
    port: 22,
    isGroup: false,
  };

  it('shows SSH library selector in GeneralSection when protocol is ssh', () => {
    render(
      <GeneralSection
        formData={{ ...baseData, protocol: Protocol.SSH }}
        setFormData={() => {}}
        availableGroups={[]}
      />
    );
    expect(screen.getAllByText(/SSH Library/i).length).toBeGreaterThan(0);
  });

  it('shows private key textarea in SSHOptions when authType is key', () => {
    render(
      <SSHOptions
        formData={{ ...baseData, authType: 'key', protocol: Protocol.SSH }}
        setFormData={() => {}}
      />
    );
    expect(screen.getByPlaceholderText(/BEGIN PRIVATE KEY/)).toBeInTheDocument();
  });

  it('shows basic auth fields in HTTPOptions', () => {
    render(
      <HTTPOptions
        formData={{ ...baseData, protocol: Protocol.HTTP, authType: 'basic' }}
        setFormData={() => {}}
      />
    );
    expect(screen.getByText(/Basic Auth Username/i)).toBeInTheDocument();
  });
});
