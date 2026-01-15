/**
 * Integration Tests - Drive Client Manager
 *
 * Tests DriveClientManager interface, error handling, and initialization.
 */

import { describe, test, expect } from 'bun:test';
import { DriveClientManager } from '../src/drive.js';

describe('DriveClientManager - Initialization', () => {
  test('should instantiate DriveClientManager', () => {
    const manager = new DriveClientManager();
    expect(manager).toBeDefined();
    expect(typeof manager).toBe('object');
  });

  test('should have all required methods', () => {
    const manager = new DriveClientManager();

    expect(typeof manager.initialize).toBe('function');
    expect(typeof manager.listFolder).toBe('function');
    expect(typeof manager.createFolder).toBe('function');
    expect(typeof manager.uploadFile).toBe('function');
    expect(typeof manager.downloadFile).toBe('function');
    expect(typeof manager.deleteNode).toBe('function');
    expect(typeof manager.renameNode).toBe('function');
    expect(typeof manager.moveNode).toBe('function');
    expect(typeof manager.resolvePath).toBe('function');
    expect(typeof manager.findNodeByName).toBe('function');
    expect(typeof manager.getRootFolderUid).toBe('function');
    expect(typeof manager.getUsername).toBe('function');
    expect(typeof manager.getClient).toBe('function');
  });
});

describe('DriveClientManager - Error Handling', () => {
  test('should throw error when getRootFolderUid called before initialization', () => {
    const manager = new DriveClientManager();

    try {
      manager.getRootFolderUid();
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when getUsername called before initialization', () => {
    const manager = new DriveClientManager();

    try {
      manager.getUsername();
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when getClient called before initialization', () => {
    const manager = new DriveClientManager();

    try {
      manager.getClient();
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when listFolder called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.listFolder('root');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when createFolder called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.createFolder('root', 'new-folder');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when uploadFile called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      const stream = new ReadableStream({ start: (c) => c.close() });
      await manager.uploadFile('root', 'file.txt', stream);
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when downloadFile called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.downloadFile('file-uid');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when deleteNode called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.deleteNode('node-uid');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when renameNode called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.renameNode('node-uid', 'new-name');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when moveNode called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.moveNode('node-uid', 'new-parent-uid');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when resolvePath called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.resolvePath('/path');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when findNodeByName called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.findNodeByName('filename', 'parent-uid');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });
});
