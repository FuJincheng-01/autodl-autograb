param([string]$Message)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show($Message, 'AutoDL 抢卡成功', 'OK', 'Information') | Out-Null
