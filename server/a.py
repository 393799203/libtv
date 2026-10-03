N = int(input("请输入整数："))
tot = 0
for i in range(N):
    print(f"{N-i: 5}", end = "")
    tot = tot + 1
    if tot % 10 == 0:
        print()