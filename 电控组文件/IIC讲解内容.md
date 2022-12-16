# IIC
## 概述
* 串行总线通信
* 完全由主机控制
* 同步通信，半双工
## 硬件电路组成
![图片显示错误](iic硬件图.png)

SDA：信号线 / SCL：时钟线

默认电平为高电平1，MCU等通信设备将其下拉至低电平表示0

输出模式：推挽输出：IIC协议支持多个主设备与多个从设备在一条总线上, 如果不用开漏输出, 而用推挽输出, 会出现主设备之间短路的情况. 至于为什么需要上拉电阻, 那是因为IIC通信需要输出高电平的能力.
能实现线与功能，从而实现多个主设备抢占总线时的仲裁。

## 寻址
总线类通信协议能实现多个设备在同一条通讯线路上的通信，为区别此时的数据要发送到/来自哪一个设备，一条总线上的器件一般都具有唯一的地址。只有地址正确才能完成和对应设备之间的数据传输。


## HAL库函数
hal库已封装函数汇总：
```c
// 阻塞模式：
HAL_I2C_Master_Transmit(); 
HAL_I2C_Master_Receive();  
HAL_I2C_Slave_Transmit();  
HAL_I2C_Slave_Receive();  
HAL_I2C_Mem_Write();
HAL_I2C_Mem_Read();   
HAL_I2C_IsDeviceReady();

// 带中断非阻塞模式：
HAL_I2C_Master_Transmit_IT();    
HAL_I2C_Master_Receive_IT();  
HAL_I2C_Slave_Transmit_IT();
HAL_I2C_Slave_Receive_IT();    
HAL_I2C_Mem_Write_IT();    
HAL_I2C_Mem_Read_IT();

// DMA传输非阻塞模式：
HAL_I2C_Master_Transmit_DMA();   
HAL_I2C_Master_Receive_DMA();
HAL_I2C_Slave_Transmit_DMA();    
HAL_I2C_Slave_Receive_DMA();    
HAL_I2C_Mem_Write_DMA();  
HAL_I2C_Mem_Read_DMA();

// 非阻塞模式下的回调函数：
HAL_I2C_MemTxCpltCallback();   
HAL_I2C_MemRxCpltCallback();    
HAL_I2C_MasterTxCpltCallback();
HAL_I2C_MasterRxCpltCallback();  
HAL_I2C_SlaveTxCpltCallback(); 
HAL_I2C_SlaveRxCpltCallback();   
HAL_I2C_ErrorCallback();
```

最常用函数简述：
```c
HAL_I2C_Master_Transmit(); 
HAL_I2C_Master_Receive();  
HAL_I2C_Mem_Write();
HAL_I2C_Mem_Read();   

HAL_StatusTypeDef HAL_I2C_Mem_Write(I2C_HandleTypeDef *hi2c, uint16_t DevAddress, uint16_t MemAddress, uint16_t MemAddSize, uint8_t *pData, uint16_t Size, uint32_t Timeout)；

```


## 硬件I2C与软件I2C
硬件IIC：上述HAL开头的函数都是HAL库已有的函数，直接在cube内配置使用iic1，iic2等，会由cube自动完成硬件配置
软件IIC：使用两个io口，用GPIO的output模式（开漏输出）并用定时器控制SCL线，同时实时手动改变SDL线的电平
实际上之前的所有通信都可以用这种方法，例如arduino的函数库中有虚拟串口相关函数，但是一般只有IIC用软件方式实现用的比较多，因为早期硬件IIC有大量bug

## 部分通信方式对比
通信方式|UART（TTL）|IIC|CAN
--|--|--|--
接线|RX，TX|SDA，SCL|CAN_H,CAN_L（不需要共地）
电平模式|推挽输出VCC，GND|开漏输出VCC、GND|差分信号
设备数量|一对一|较多个（总线）|较多个（总线）
时钟|异步|同步|异步
方向|全双工|半双工|半双工