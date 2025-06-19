FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Update and install base dependencies
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y \
    # Basic utilities
    curl \
    wget \
    git \
    vim \
    nano \
    htop \
    tree \
    jq \
    zip \
    unzip \
    # Build essentials
    build-essential \
    pkg-config \
    # Network tools
    net-tools \
    iputils-ping \
    dnsutils \
    netcat-openbsd \
    traceroute \
    tcpdump \
    nmap \
    iperf3 \
    # HTTP tools
    httpie \
    # Process management
    supervisor \
    # Database clients
    postgresql-client \
    redis-tools \
    # Other useful tools
    tmux \
    screen \
    rsync \
    openssh-client \
    gnupg \
    lsb-release \
    ca-certificates \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && \
    apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Install ripgrep
RUN curl -LO https://github.com/BurntSushi/ripgrep/releases/download/14.1.0/ripgrep_14.1.0-1_amd64.deb && \
    dpkg -i ripgrep_14.1.0-1_amd64.deb && \
    rm ripgrep_14.1.0-1_amd64.deb

# Install Python 3.12
RUN add-apt-repository ppa:deadsnakes/ppa -y && \
    apt-get update && \
    apt-get install -y \
    python3.12 \
    python3.12-venv \
    python3.12-dev \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.12 as default python3
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 && \
    update-alternatives --set python3 /usr/bin/python3.12

# Install Python development tools
RUN python3 -m pip install --upgrade pip setuptools wheel && \
    python3 -m pip install \
    pipenv \
    poetry \
    black \
    flake8 \
    mypy \
    pytest \
    ipython \
    jupyter \
    ruff \
    uvicorn[standard]

# Install Docker
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add - && \
    add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" && \
    apt-get update && \
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js via NVM
ENV NVM_DIR=/usr/local/nvm
ENV NODE_VERSION=lts/iron

RUN mkdir -p $NVM_DIR && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    . $NVM_DIR/nvm.sh && \
    nvm install $NODE_VERSION && \
    nvm use $NODE_VERSION && \
    nvm alias default $NODE_VERSION

# Add NVM to PATH
ENV PATH=$NVM_DIR/versions/node/v20.11.1/bin:$PATH

# Install global Node.js packages
RUN npm install -g \
    pnpm@8.15.1 \
    turbo \
    typescript \
    tsx \
    nodemon \
    npm-check-updates \
    vercel \
    @githubnext/github-copilot-cli \
    @anthropic-ai/claude-code \
    ccusage \
    task-master-ai

# Install additional development tools
RUN apt-get update && \
    apt-get install -y \
    # Shell enhancements
    zsh \
    fish \
    # File watchers
    inotify-tools \
    # Process monitoring
    strace \
    ltrace \
    # Performance tools
    sysstat \
    iotop \
    # Archive tools
    p7zip-full \
    # Terminal multiplexers
    byobu \
    && rm -rf /var/lib/apt/lists/*

# Install bat (better cat)
RUN curl -LO https://github.com/sharkdp/bat/releases/download/v0.24.0/bat_0.24.0_amd64.deb && \
    dpkg -i bat_0.24.0_amd64.deb && \
    rm bat_0.24.0_amd64.deb

# Install lazygit
RUN LAZYGIT_VERSION=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" | grep -Po '"tag_name": "v\K[^"]*') && \
    curl -Lo lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/latest/download/lazygit_${LAZYGIT_VERSION}_Linux_x86_64.tar.gz" && \
    tar xf lazygit.tar.gz lazygit && \
    install lazygit /usr/local/bin && \
    rm lazygit.tar.gz lazygit

# Install fzf (fuzzy finder)
RUN git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf && \
    ~/.fzf/install --all --no-bash --no-fish

# Install claude-squad (requires tmux which we already have)
RUN curl -fsSL https://raw.githubusercontent.com/smtg-ai/claude-squad/main/install.sh | bash

# Create a non-root user
ARG USERNAME=developer
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN groupadd --gid $USER_GID $USERNAME && \
    useradd --uid $USER_UID --gid $USER_GID -m $USERNAME && \
    echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME && \
    chmod 0440 /etc/sudoers.d/$USERNAME && \
    usermod -aG docker $USERNAME

# Switch to non-root user
USER $USERNAME
WORKDIR /home/$USERNAME

# Configure git
RUN git config --global init.defaultBranch main && \
    git config --global pull.rebase false

# Set up shell
RUN sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended && \
    git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions && \
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting && \
    sed -i 's/plugins=(git)/plugins=(git docker docker-compose node npm nvm python pip zsh-autosuggestions zsh-syntax-highlighting)/' ~/.zshrc

# Add NVM to shell configs
RUN echo 'export NVM_DIR="/usr/local/nvm"' >> ~/.zshrc && \
    echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.zshrc && \
    echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.zshrc

# Set default shell
ENV SHELL=/bin/zsh

# Clean up
USER root
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

USER $USERNAME

# Set the default command
CMD ["/bin/zsh"]

