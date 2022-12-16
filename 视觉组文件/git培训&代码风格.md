# git&代码规范培训

注意: 本次培训含有预习内容, 请**确保**在培训之前已经预习完要求的内容

## 内容: 

- git的使用(预习+培训梳理)
- 以及简要的代码规范提及(自学)

代码规范只涉及风格问题, 关于代码命名规范/工程规范超出了范畴, 也不是一节课能讲完的, 所以略过
本次重点在于使用git, 希望本次培训能帮助大家掌握这个初学者非常不友好的工具
种种数据表明, 很少有人能第一次学习就能流畅掌握git, 所以需要大家先自行学习一遍再在课上梳理

> 推荐这个网站[https://csdiy.wiki/](https://csdiy.wiki/), 内容非常丰富
> 关于软件工程的系统性课程可以看这篇[csdiy: MIT 6.031 Software Construction](https://csdiy.wiki/%E8%BD%AF%E4%BB%B6%E5%B7%A5%E7%A8%8B/6031/)

## "免修条件" 

如果你清楚以下内容, 可以不用参加本次培训

- 熟悉git并且有使用git管理过多个项目
- git的历史改写
- add, commit, push, pull, fetch
- 代码规范方面明确应该写第一种写法的代码而不是第二种及其原因

```cpp
// 第一种 好
void do_something(int a, std::vector<int> &b) {
    if (not_important) {
        auto &last = b[b.size() - 1];   // 还知道要写点注释
        do_something_else(a, b);
        last += a;
    }
}

// 第二种 坏!
void dosomething(int a,std::vector<int> &b){
    if(not_important){
        auto &last=b[b.size()-1];
        do_something_else(a ,b);
        last+=a;
    }
}
```

# Part 1 代码风格要求

虽然好看的代码长什么样没有太多定论, 但是什么代码长得很丑是有确定的结论的, 请以下代码规范:
> *(没)有证据表明, 代码写的不好看的人, 容易编译不通过, 丧失对编程能力的信心, 进而失去人生目标, 从而走上违法犯罪的道路*

[原链接: code style guide](https://sp21.datastructur.es/materials/guides/style-guide)

摘取了里面最重要的内容, 其他的扫一遍有个印象就可以了, 里面含有一些Java代码风格规范问题, 但是不影响理解
原文提到的generic泛型跟c++的模板大致类似

1. 应该使用空格缩进而不是Tab缩进
2. 应该加空格的地方有
   1. `,`的后面, 比如`foo(a, b)`, `int add(int a, int b)`
   2. 各种二元操作符`a + b`, `a += b`, `a != b`
   3. 赋值`=`两侧`a = b`
   4. 三元操作数`x > 0 ? x : -x`
   5. 换行应该在操作符之前
    ```
    ... + 20 * X
        + Y;
    ```
   6. 在流程控制的花括号前面加空格, 比如说`if (condition) {`而不是`if (condition){`
3. 不应该加空格的地方有:
   1. 括号/尖括号"<"的后面, ">"的前面, 比如`List<int>`
   2. 一元操作符`a++`, `!a`, `++a`
   3. `;`前面
   4. `.`后面
4. 缩进
   1. 四空格缩进

每个文件的大小尽量不要超过700行(一个简单的参考标准, 不是明确规定)
不应该有某个函数长度超过100行(一个简单的参考标准, 不是明确规定)

显然视觉组查阅资料不可避免需要查阅众多英文文献, 希望此前没有这方面经验的同学迅速适应

<hr/>

# Part 2 Git培训

我们的培训流程主要根据MIT missing semester的流程复刻, 但是会重点在于日常一定会用到的命令

自学:

[missing semester_version control(git)](https://missing.csail.mit.edu/2020/version-control/)这个链接的视频是内嵌的youtube视频, 如果不能观看可以[在b站观看](https://www.bilibili.com/video/BV1x7411H7wa?p=6)如果不想看视频可以看网站的文字, 和视频内容是等价的, 推荐看视频, 可以看老师演示

完成以下两个任务:
- 自行看完整个视频
- 自己再另外查看一个git教程(任意), 然后跟学一下

*不出意外的话学完了多半还是不咋会用:)
猜错了说明你确实学习能力很不错:(*

参考资料:

[Git官网](https://git-scm.com/)
[Pro Git(git官网学习资料, 中文版)](https://git-scm.com/book/zh/v2)

# Part3 额外一个tip

有些同学似乎对连续两个下划线开头的变量名情有独钟, 不建议如此做

根据c++标准(2003 C++ standard)

> 17.4.3.1.2 Global names [lib.global.names]
> Certain sets of names and function signatures are always reserved to the implementation:
> 
> **Each name that contains a double underscore (__) or begins with an underscore followed by an uppercase letter (2.11) is reserved to the implementation for any use.**
> Each name that begins with an underscore is reserved to the implementation for use as a name in the global namespace.
> Such names are also reserved in namespace ::std (17.4.3.1).
