# Integration Patterns Translation

**Converting desktop system integrations to web-based service integrations**

## Overview

Claudia's integration patterns include **Claude CLI process management**, **MCP server communication**, **file system access**, and **OS-level security**. For Pocket Console, these need translation to **containerized execution**, **WebSocket communication**, **cloud storage**, and **API-based security**.

## Claude CLI Integration Translation

### Current Desktop Pattern (Process Management)

#### Claudia's Process Management
```rust
// src-tauri/src/commands/claude.rs
pub struct ClaudeProcessState {
    pub process: Arc<Mutex<Option<Child>>>,
    pub current_session_id: Arc<Mutex<Option<String>>>,
}

#[tauri::command]
pub async fn execute_claude_code(
    state: State<'_, ClaudeProcessState>,
    project_path: String,
    prompt: String,
    model: String,
) -> Result<(), String> {
    let mut child = Command::new("claude")
        .args(["--project", &project_path])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Claude process: {}", e))?;
    
    // Process management...
    let mut process_lock = state.process.lock().await;
    *process_lock = Some(child);
    
    Ok(())
}
```

### Web-Based Container Integration

#### Docker Container Management Pattern
```typescript
// Backend: FastAPI with Docker integration
from fastapi import FastAPI, WebSocket
import docker
import asyncio
import json

class ContainerManager:
    def __init__(self):
        self.client = docker.from_env()
        self.active_containers: Dict[str, docker.models.containers.Container] = {}
    
    async def create_claude_session(
        self,
        session_id: str,
        project_path: str,
        user_id: str,
        security_profile: SecurityProfile
    ) -> ContainerInfo:
        # Create secure container environment
        container = self.client.containers.run(
            image="claude-sandbox:latest",
            command=["claude", "--session-mode"],
            working_dir="/workspace",
            volumes={
                project_path: {"bind": "/workspace", "mode": "rw"},
                "/tmp/claude-cache": {"bind": "/cache", "mode": "rw"}
            },
            environment={
                "CLAUDE_SESSION_ID": session_id,
                "USER_ID": user_id,
                "SECURITY_PROFILE": security_profile.name
            },
            network_mode="none" if not security_profile.network_access else "bridge",
            mem_limit=security_profile.memory_limit,
            cpu_quota=int(security_profile.cpu_limit * 100000),
            detach=True,
            remove=True,  # Auto-cleanup
            labels={
                "pocket-console.session-id": session_id,
                "pocket-console.user-id": user_id
            }
        )
        
        self.active_containers[session_id] = container
        
        return ContainerInfo(
            session_id=session_id,
            container_id=container.id,
            status="running",
            created_at=datetime.utcnow()
        )
    
    async def execute_command(
        self, 
        session_id: str, 
        command: str
    ) -> AsyncGenerator[str, None]:
        container = self.active_containers.get(session_id)
        if not container:
            raise ValueError(f"No active container for session {session_id}")
        
        # Execute command and stream output
        exec_result = container.exec_run(
            f"claude exec '{command}'",
            stream=True,
            demux=True
        )
        
        for chunk in exec_result.output:
            if chunk:
                yield chunk.decode('utf-8')

# FastAPI WebSocket endpoint
@app.websocket("/ws/session/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    
    try:
        while True:
            # Receive command from client
            data = await websocket.receive_json()
            command = data.get("command")
            
            if command:
                # Execute in container and stream response
                async for output in container_manager.execute_command(session_id, command):
                    await websocket.send_json({
                        "type": "output",
                        "data": output,
                        "timestamp": datetime.utcnow().isoformat()
                    })
    
    except WebSocketDisconnect:
        await container_manager.cleanup_session(session_id)
```

#### Frontend WebSocket Integration
```typescript
// Frontend: Real-time container communication
class ContainerSession {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  constructor(
    private sessionId: string,
    private onMessage: (message: ContainerMessage) => void,
    private onStatusChange: (status: ConnectionStatus) => void
  ) {}
  
  async connect(): Promise<void> {
    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL}/ws/session/${this.sessionId}`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      this.onStatusChange('connected');
      this.reconnectAttempts = 0;
    };
    
    this.ws.onmessage = (event) => {
      const message: ContainerMessage = JSON.parse(event.data);
      this.onMessage(message);
    };
    
    this.ws.onclose = (event) => {
      this.onStatusChange('disconnected');
      
      if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.onStatusChange('error');
    };
  }
  
  async executeCommand(command: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'command',
        command,
        timestamp: new Date().toISOString()
      }));
    } else {
      throw new Error('WebSocket not connected');
    }
  }
  
  private scheduleReconnect(): void {
    const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff
    
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }
  
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }
}

// React hook for container session management
const useContainerSession = (sessionId: string) => {
  const [messages, setMessages] = useState<ContainerMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const sessionRef = useRef<ContainerSession | null>(null);
  
  useEffect(() => {
    const session = new ContainerSession(
      sessionId,
      (message) => setMessages(prev => [...prev, message]),
      setConnectionStatus
    );
    
    sessionRef.current = session;
    session.connect();
    
    return () => {
      session.disconnect();
    };
  }, [sessionId]);
  
  const executeCommand = useCallback(async (command: string) => {
    if (sessionRef.current) {
      await sessionRef.current.executeCommand(command);
    }
  }, []);
  
  return {
    messages,
    connectionStatus,
    executeCommand,
  };
};
```

## MCP Server Integration Translation

### Current Desktop Pattern (Local Processes)

#### Claudia's MCP Management
```rust
// src-tauri/src/commands/mcp.rs
#[tauri::command]
pub async fn mcp_add(
    name: String,
    transport: String,
    command: Option<String>,
    args: Vec<String>,
    env: HashMap<String, String>,
    url: Option<String>,
    scope: String,
) -> Result<AddServerResult, String> {
    // Local process management for MCP servers
    match transport.as_str() {
        "stdio" => {
            if let Some(cmd) = command {
                let mut child = Command::new(&cmd)
                    .args(&args)
                    .envs(&env)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .spawn()
                    .map_err(|e| format!("Failed to spawn MCP server: {}", e))?;
                
                // Store process handle...
            }
        },
        "sse" => {
            // HTTP-based MCP server connection
        },
        _ => return Err("Unsupported transport".to_string()),
    }
    
    Ok(AddServerResult { success: true })
}
```

### Web-Based MCP Service Integration

#### Containerized MCP Server Management
```typescript
// Backend: MCP server orchestration
class MCPServerManager {
  private docker = new Docker();
  private activeServers: Map<string, MCPServerInstance> = new Map();
  
  async createMCPServer(config: MCPServerConfig): Promise<MCPServerInstance> {
    const containerId = await this.deployMCPContainer(config);
    
    const instance: MCPServerInstance = {
      id: generateId(),
      name: config.name,
      containerId,
      transport: config.transport,
      status: 'starting',
      endpoint: await this.generateEndpoint(config),
      healthCheckUrl: `/health/${containerId}`,
      createdAt: new Date(),
    };
    
    this.activeServers.set(instance.id, instance);
    
    // Start health monitoring
    this.startHealthMonitoring(instance);
    
    return instance;
  }
  
  private async deployMCPContainer(config: MCPServerConfig): Promise<string> {
    const container = await this.docker.createContainer({
      Image: config.dockerImage || 'mcp-server-base:latest',
      Env: [
        `MCP_SERVER_NAME=${config.name}`,
        `MCP_TRANSPORT=${config.transport}`,
        ...Object.entries(config.environment).map(([k, v]) => `${k}=${v}`)
      ],
      ExposedPorts: { '3000/tcp': {} },
      HostConfig: {
        PortBindings: { '3000/tcp': [{ HostPort: '0' }] },
        Memory: 256 * 1024 * 1024, // 256MB limit
        CpuQuota: 50000, // 0.5 CPU
        NetworkMode: config.networkAccess ? 'bridge' : 'none',
      },
      Labels: {
        'pocket-console.mcp-server': 'true',
        'pocket-console.server-name': config.name,
      },
    });
    
    await container.start();
    return container.id;
  }
  
  async testConnection(serverId: string): Promise<ConnectionResult> {
    const server = this.activeServers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }
    
    try {
      const response = await fetch(server.healthCheckUrl, {
        timeout: 5000,
      });
      
      return {
        success: response.ok,
        latency: response.headers.get('x-response-time'),
        version: response.headers.get('x-mcp-version'),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  private startHealthMonitoring(instance: MCPServerInstance): void {
    const healthCheck = setInterval(async () => {
      try {
        const result = await this.testConnection(instance.id);
        instance.status = result.success ? 'running' : 'unhealthy';
        
        // Emit status update via WebSocket
        this.emitStatusUpdate(instance);
        
      } catch (error) {
        instance.status = 'error';
        instance.lastError = error.message;
      }
    }, 30000); // Check every 30 seconds
    
    // Store interval ID for cleanup
    instance.healthCheckInterval = healthCheck;
  }
}

// API endpoints for MCP management
@app.post("/api/mcp/servers")
async def create_mcp_server(config: MCPServerConfig) -> MCPServerInstance:
    return await mcp_manager.createMCPServer(config)

@app.get("/api/mcp/servers")
async def list_mcp_servers() -> List[MCPServerInstance]:
    return list(mcp_manager.activeServers.values())

@app.post("/api/mcp/servers/{server_id}/test")
async def test_mcp_connection(server_id: str) -> ConnectionResult:
    return await mcp_manager.testConnection(server_id)
```

#### Frontend MCP Management Interface
```typescript
// React component for MCP server management
const MCPServerManager: React.FC = () => {
  const { data: servers, isLoading } = useMCPServersQuery();
  const createServerMutation = useCreateMCPServerMutation();
  const testConnectionMutation = useTestMCPConnectionMutation();
  
  // Real-time status updates via WebSocket
  useWebSocketSubscription('mcp-status-updates', (update: MCPStatusUpdate) => {
    queryClient.setQueryData(['mcp-servers'], (oldServers: MCPServerInstance[]) =>
      oldServers.map(server =>
        server.id === update.serverId
          ? { ...server, status: update.status, lastUpdated: update.timestamp }
          : server
      )
    );
  });
  
  const handleCreateServer = async (config: MCPServerConfig) => {
    try {
      await createServerMutation.mutateAsync(config);
      toast.success('MCP server created successfully');
    } catch (error) {
      toast.error(`Failed to create server: ${error.message}`);
    }
  };
  
  const handleTestConnection = async (serverId: string) => {
    try {
      const result = await testConnectionMutation.mutateAsync(serverId);
      toast.success(
        result.success 
          ? `Connection successful (${result.latency}ms)` 
          : `Connection failed: ${result.error}`
      );
    } catch (error) {
      toast.error(`Test failed: ${error.message}`);
    }
  };
  
  if (isLoading) {
    return <MCPServerListSkeleton />;
  }
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">MCP Servers</h1>
        <CreateMCPServerDialog onCreateServer={handleCreateServer} />
      </div>
      
      <div className="grid gap-4">
        {servers?.map(server => (
          <MCPServerCard
            key={server.id}
            server={server}
            onTest={() => handleTestConnection(server.id)}
          />
        ))}
      </div>
    </div>
  );
};
```

## File System Integration Translation

### Current Desktop Pattern (Direct FS Access)

#### Claudia's File System Access
```rust
// Direct file system operations
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub async fn read_project_files(project_path: String) -> Result<Vec<FileInfo>, String> {
    let path = PathBuf::from(project_path);
    let mut files = Vec::new();
    
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        
        files.push(FileInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            size: metadata.len(),
            is_directory: metadata.is_dir(),
            modified: metadata.modified().ok(),
        });
    }
    
    Ok(files)
}
```

### Web-Based Cloud Storage Integration

#### Cloud Storage Service Layer
```typescript
// Backend: Cloud storage abstraction
interface CloudStorageProvider {
  uploadFile(path: string, content: Buffer, metadata?: FileMetadata): Promise<UploadResult>;
  downloadFile(path: string): Promise<DownloadResult>;
  listFiles(directory: string): Promise<FileInfo[]>;
  deleteFile(path: string): Promise<boolean>;
  moveFile(fromPath: string, toPath: string): Promise<boolean>;
  getFileUrl(path: string, expiresIn?: number): Promise<string>;
}

class S3StorageProvider implements CloudStorageProvider {
  constructor(private s3Client: S3Client, private bucketName: string) {}
  
  async uploadFile(path: string, content: Buffer, metadata?: FileMetadata): Promise<UploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: path,
      Body: content,
      Metadata: metadata,
      ContentType: this.inferContentType(path),
    });
    
    const result = await this.s3Client.send(command);
    
    return {
      success: true,
      path,
      etag: result.ETag,
      versionId: result.VersionId,
    };
  }
  
  async listFiles(directory: string): Promise<FileInfo[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: directory,
      Delimiter: '/',
    });
    
    const result = await this.s3Client.send(command);
    const files: FileInfo[] = [];
    
    // Add files
    result.Contents?.forEach(object => {
      files.push({
        name: path.basename(object.Key || ''),
        path: object.Key || '',
        size: object.Size || 0,
        isDirectory: false,
        lastModified: object.LastModified,
        etag: object.ETag,
      });
    });
    
    // Add directories
    result.CommonPrefixes?.forEach(prefix => {
      files.push({
        name: path.basename(prefix.Prefix || ''),
        path: prefix.Prefix || '',
        size: 0,
        isDirectory: true,
        lastModified: new Date(),
      });
    });
    
    return files;
  }
}

// File management service
class FileService {
  constructor(
    private storageProvider: CloudStorageProvider,
    private userService: UserService
  ) {}
  
  async getUserFiles(userId: string, directory?: string): Promise<FileInfo[]> {
    const userPath = `users/${userId}/${directory || ''}`;
    return this.storageProvider.listFiles(userPath);
  }
  
  async uploadUserFile(
    userId: string,
    filePath: string,
    content: Buffer
  ): Promise<UploadResult> {
    const userPath = `users/${userId}/${filePath}`;
    
    // Check user storage quota
    await this.checkStorageQuota(userId, content.length);
    
    return this.storageProvider.uploadFile(userPath, content, {
      uploadedBy: userId,
      uploadedAt: new Date().toISOString(),
    });
  }
  
  async getFileDownloadUrl(userId: string, filePath: string): Promise<string> {
    const userPath = `users/${userId}/${filePath}`;
    
    // Check user permissions
    await this.checkFileAccess(userId, userPath);
    
    return this.storageProvider.getFileUrl(userPath, 3600); // 1 hour expiry
  }
  
  private async checkStorageQuota(userId: string, fileSize: number): Promise<void> {
    const usage = await this.getUserStorageUsage(userId);
    const quota = await this.getUserStorageQuota(userId);
    
    if (usage.total + fileSize > quota) {
      throw new Error('Storage quota exceeded');
    }
  }
}
```

#### Frontend File Management
```typescript
// React hooks for file management
const useFileManager = (directory?: string) => {
  const { data: files, isLoading, refetch } = useQuery({
    queryKey: ['files', directory],
    queryFn: () => FileAPI.listFiles(directory),
  });
  
  const uploadMutation = useMutation({
    mutationFn: ({ file, path }: { file: File; path?: string }) =>
      FileAPI.uploadFile(file, path),
    onSuccess: () => {
      refetch();
      toast.success('File uploaded successfully');
    },
    onError: (error) => {
      toast.error(`Upload failed: ${error.message}`);
    },
  });
  
  const downloadMutation = useMutation({
    mutationFn: (filePath: string) => FileAPI.downloadFile(filePath),
    onSuccess: (downloadUrl, filePath) => {
      // Trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = path.basename(filePath);
      link.click();
    },
  });
  
  const uploadFile = useCallback(
    async (file: File, targetPath?: string) => {
      return uploadMutation.mutateAsync({ file, path: targetPath });
    },
    [uploadMutation]
  );
  
  const downloadFile = useCallback(
    async (filePath: string) => {
      return downloadMutation.mutateAsync(filePath);
    },
    [downloadMutation]
  );
  
  return {
    files,
    isLoading,
    uploadFile,
    downloadFile,
    refreshFiles: refetch,
    isUploading: uploadMutation.isPending,
    isDownloading: downloadMutation.isPending,
  };
};

// File upload component with drag & drop
const FileUploadZone: React.FC<{
  onUpload: (files: File[]) => void;
  accept?: string;
  maxSize?: number;
  multiple?: boolean;
}> = ({ onUpload, accept, maxSize = 10 * 1024 * 1024, multiple = true }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(file => {
      if (maxSize && file.size > maxSize) {
        toast.error(`File ${file.name} is too large (max ${formatBytes(maxSize)})`);
        return false;
      }
      return true;
    });
    
    if (validFiles.length > 0) {
      onUpload(validFiles);
    }
  }, [onUpload, maxSize]);
  
  return (
    <div
      className={cn(
        "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
        isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
      <h3 className="text-lg font-medium mb-2">Drop files here</h3>
      <p className="text-muted-foreground mb-4">
        or click to select files
      </p>
      <input
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) {
            onUpload(files);
          }
        }}
        className="hidden"
        id="file-upload"
      />
      <label
        htmlFor="file-upload"
        className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md cursor-pointer hover:bg-primary/90"
      >
        Select Files
      </label>
    </div>
  );
};
```

## Security Integration Translation

### Current Desktop Pattern (OS-Level Sandboxing)

#### Claudia's Security Model
```rust
// OS-level sandbox enforcement
use gaol::sandbox::{Sandbox, SandboxMethods};
use gaol::profile::{Profile, ProfileMethods};

pub fn create_sandbox_profile(rules: &[SandboxRule]) -> Result<Profile, String> {
    let mut profile = Profile::new();
    
    for rule in rules {
        match rule.operation_type.as_str() {
            "file_read_all" => {
                profile.allow_file_read_metadata(&PathBuf::from(&rule.pattern_value))?;
            },
            "network_outbound" => {
                profile.allow_network_outbound()?;
            },
            _ => {
                return Err(format!("Unknown operation: {}", rule.operation_type));
            }
        }
    }
    
    Ok(profile)
}
```

### Web-Based Container Security

#### Container Security Profiles
```typescript
// Backend: Container security management
interface SecurityProfile {
  name: string;
  description: string;
  containerConfig: ContainerSecurityConfig;
  resourceLimits: ResourceLimits;
  networkPolicy: NetworkPolicy;
  fileSystemPolicy: FileSystemPolicy;
}

interface ContainerSecurityConfig {
  readOnlyRootFilesystem: boolean;
  noNewPrivileges: boolean;
  dropCapabilities: string[];
  seccompProfile?: string;
  apparmorProfile?: string;
  runAsNonRoot: boolean;
  runAsUser?: number;
  runAsGroup?: number;
}

class SecurityProfileManager {
  private profiles: Map<string, SecurityProfile> = new Map();
  
  constructor() {
    this.initializeDefaultProfiles();
  }
  
  private initializeDefaultProfiles(): void {
    // Minimal security profile
    this.profiles.set('minimal', {
      name: 'minimal',
      description: 'Highly restrictive profile for untrusted code',
      containerConfig: {
        readOnlyRootFilesystem: true,
        noNewPrivileges: true,
        dropCapabilities: ['ALL'],
        runAsNonRoot: true,
        runAsUser: 65534, // nobody user
        runAsGroup: 65534,
      },
      resourceLimits: {
        memory: '128MB',
        cpu: '0.25',
        diskIO: '10MB/s',
        networkBandwidth: '1MB/s',
      },
      networkPolicy: {
        allowOutbound: false,
        allowedDomains: [],
        blockedPorts: [22, 3389, 5432, 3306], // SSH, RDP, DB ports
      },
      fileSystemPolicy: {
        allowedReadPaths: ['/workspace'],
        allowedWritePaths: ['/tmp'],
        deniedPaths: ['/etc', '/usr', '/bin'],
      },
    });
    
    // Standard security profile
    this.profiles.set('standard', {
      name: 'standard',
      description: 'Balanced security for general development',
      containerConfig: {
        readOnlyRootFilesystem: false,
        noNewPrivileges: true,
        dropCapabilities: ['SYS_ADMIN', 'NET_ADMIN', 'SYS_MODULE'],
        runAsNonRoot: true,
        runAsUser: 1000,
        runAsGroup: 1000,
      },
      resourceLimits: {
        memory: '512MB',
        cpu: '1.0',
        diskIO: '50MB/s',
        networkBandwidth: '10MB/s',
      },
      networkPolicy: {
        allowOutbound: true,
        allowedDomains: ['*.npmjs.org', '*.pypi.org', 'github.com'],
        blockedPorts: [22, 3389],
      },
      fileSystemPolicy: {
        allowedReadPaths: ['/workspace', '/usr/lib', '/usr/share'],
        allowedWritePaths: ['/workspace', '/tmp', '/home/user'],
        deniedPaths: ['/etc/passwd', '/etc/shadow'],
      },
    });
  }
  
  applySecurityProfile(
    containerConfig: any,
    profileName: string
  ): ContainerCreateOptions {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new Error(`Security profile '${profileName}' not found`);
    }
    
    return {
      ...containerConfig,
      HostConfig: {
        ...containerConfig.HostConfig,
        ReadonlyRootfs: profile.containerConfig.readOnlyRootFilesystem,
        SecurityOpt: [
          'no-new-privileges:true',
          ...(profile.containerConfig.seccompProfile 
            ? [`seccomp:${profile.containerConfig.seccompProfile}`] 
            : []),
          ...(profile.containerConfig.apparmorProfile 
            ? [`apparmor:${profile.containerConfig.apparmorProfile}`] 
            : []),
        ],
        CapDrop: profile.containerConfig.dropCapabilities,
        Memory: this.parseMemoryLimit(profile.resourceLimits.memory),
        CpuQuota: Math.floor(parseFloat(profile.resourceLimits.cpu) * 100000),
        NetworkMode: profile.networkPolicy.allowOutbound ? 'bridge' : 'none',
      },
      User: profile.containerConfig.runAsNonRoot 
        ? `${profile.containerConfig.runAsUser}:${profile.containerConfig.runAsGroup}`
        : undefined,
    };
  }
  
  validateSecurityViolation(
    action: SecurityAction,
    profileName: string
  ): SecurityViolation | null {
    const profile = this.profiles.get(profileName);
    if (!profile) return null;
    
    switch (action.type) {
      case 'file_access':
        return this.validateFileAccess(action, profile.fileSystemPolicy);
      case 'network_access':
        return this.validateNetworkAccess(action, profile.networkPolicy);
      case 'resource_usage':
        return this.validateResourceUsage(action, profile.resourceLimits);
      default:
        return null;
    }
  }
}
```

#### Frontend Security Management
```typescript
// React component for security profile management
const SecurityProfileSelector: React.FC<{
  selectedProfile?: string;
  onProfileChange: (profile: string) => void;
}> = ({ selectedProfile, onProfileChange }) => {
  const { data: profiles } = useSecurityProfilesQuery();
  const { data: violations } = useSecurityViolationsQuery(selectedProfile);
  
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="security-profile">Security Profile</Label>
        <Select value={selectedProfile} onValueChange={onProfileChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select security profile" />
          </SelectTrigger>
          <SelectContent>
            {profiles?.map(profile => (
              <SelectItem key={profile.name} value={profile.name}>
                <div className="flex items-center space-x-2">
                  <Shield className="h-4 w-4" />
                  <div>
                    <div className="font-medium">{profile.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {profile.description}
                    </div>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {violations && violations.length > 0 && (
        <div className="p-4 border border-destructive/20 rounded-lg bg-destructive/5">
          <div className="flex items-center space-x-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="font-medium text-destructive">
              Security Violations Detected
            </span>
          </div>
          <div className="space-y-1">
            {violations.slice(0, 3).map(violation => (
              <div key={violation.id} className="text-sm text-muted-foreground">
                {violation.description}
              </div>
            ))}
            {violations.length > 3 && (
              <div className="text-sm text-muted-foreground">
                +{violations.length - 3} more violations
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
```

## Integration Summary

### Migration Strategy

#### Phase 1: Core Infrastructure
1. **Container Runtime**: Set up Docker-based execution environment
2. **WebSocket Communication**: Implement real-time client-server communication
3. **Cloud Storage**: Configure file storage and access patterns
4. **Basic Security**: Implement container-based security profiles

#### Phase 2: Service Integration
1. **MCP Server Management**: Deploy containerized MCP servers
2. **Session Management**: Implement persistent session storage
3. **Resource Management**: Add resource quotas and monitoring
4. **Authentication**: Integrate user authentication and authorization

#### Phase 3: Advanced Features
1. **Security Monitoring**: Real-time violation detection and reporting
2. **Performance Optimization**: Container pooling and resource optimization
3. **High Availability**: Load balancing and failover mechanisms
4. **Compliance**: Audit logging and security compliance features

### Key Translation Points

| Desktop Pattern | Web Pattern | Implementation |
|----------------|-------------|----------------|
| Process spawning | Container creation | Docker API |
| Direct file access | Cloud storage | S3/GCS APIs |
| OS-level sandboxing | Container security | Security profiles |
| Local MCP servers | Containerized services | Docker orchestration |
| Tauri events | WebSocket messages | Real-time communication |
| SQLite storage | Database + caching | PostgreSQL + Redis |

---

*Integration patterns for web-native architecture with containerized security*